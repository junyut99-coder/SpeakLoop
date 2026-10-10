import base64
import io
import json
import logging
import re
import wave
import httpx
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from sqlmodel import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, SessionDep
from app.models import PracticeSession, SpeechAssessment
from app.schemas import LanguageCode, SpeechAssessmentPublic


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/speech", tags=["语音评分"])

MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_AUDIO_SECONDS = 30
SAMPLE_RATE = 16_000
LOCALE_BY_LANGUAGE = {"en": "en-US", "ja": "ja-JP", "zh": "zh-CN"}


def _audio_duration(payload: bytes) -> float:
    try:
        with wave.open(io.BytesIO(payload), "rb") as audio:
            if audio.getcomptype() != "NONE":
                raise ValueError("压缩 WAV 不受支持")
            if (
                audio.getnchannels() != 1
                or audio.getsampwidth() != 2
                or audio.getframerate() != SAMPLE_RATE
            ):
                raise ValueError("音频格式不正确")
            duration = audio.getnframes() / SAMPLE_RATE
    except (wave.Error, EOFError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="录音格式无效，请重新录制后再试。",
        ) from exc
    if duration <= 0 or duration > MAX_AUDIO_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="每次发音评分最多支持 30 秒录音。",
        )
    return duration


def _score(value: object, *, five_point: bool = False) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    number = float(value)
    if five_point and number > 5:
        number /= 20
    return round(max(0.0, min(5.0 if five_point else 100.0, number)), 1)


def _word_details(items: object) -> list[dict[str, object]]:
    if not isinstance(items, list):
        return []
    output: list[dict[str, object]] = []
    for item in items[:200]:
        if not isinstance(item, dict):
            continue
        assessment = item.get("PronunciationAssessment") or item
        assessment = assessment if isinstance(assessment, dict) else {}
        phonemes = []
        phoneme_items = item.get("Phonemes")
        if not isinstance(phoneme_items, list):
            phoneme_items = []
        for phoneme in phoneme_items[:100]:
            if not isinstance(phoneme, dict):
                continue
            phoneme_assessment = phoneme.get("PronunciationAssessment") or phoneme
            phoneme_assessment = phoneme_assessment if isinstance(phoneme_assessment, dict) else {}
            phonemes.append(
                {
                    "phoneme": str(phoneme.get("Phoneme", ""))[:32],
                    "score": _score(phoneme_assessment.get("AccuracyScore")),
                    "error_type": str(phoneme_assessment.get("ErrorType", "None"))[:32],
                }
            )
        output.append(
            {
                "word": str(item.get("Word", ""))[:128],
                "score": _score(assessment.get("AccuracyScore")),
                "error_type": str(assessment.get("ErrorType", "None"))[:32],
                "phonemes": phonemes,
            }
        )
    return output


@router.post("/assessments", response_model=SpeechAssessmentPublic, status_code=201)
async def assess_pronunciation(
    current_user: CurrentUser,
    session: SessionDep,
    audio: UploadFile = File(...),
    reference_text: str = Form(min_length=1, max_length=1000),
    language: LanguageCode = Form(...),
    session_id: str | None = Form(default=None, max_length=36),
) -> SpeechAssessment:
    reference_text = reference_text.strip()
    if not reference_text:
        raise HTTPException(status_code=422, detail="缺少跟读练习文本。")
    if not settings.azure_speech_key or not settings.azure_speech_region:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="真实语音评分尚未配置。请在后端设置 Azure Speech Key 和 Region。",
        )

    audio_bytes = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="录音文件过大，请缩短录音后重试。")
    _audio_duration(audio_bytes)

    if session_id:
        practice_session = session.get(PracticeSession, session_id)
        if practice_session is None or practice_session.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="没有找到这条练习记录。")

    assessment_options = {
        "ReferenceText": reference_text,
        "GradingSystem": "FivePoint",
        "Granularity": "Phoneme",
        "Dimension": "Comprehensive",
        "EnableMiscue": True,
    }
    if language == "en":
        assessment_options["EnableProsodyAssessment"] = "True"
    headers = {
        "Ocp-Apim-Subscription-Key": settings.azure_speech_key,
        "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        "Accept": "application/json",
        "Pronunciation-Assessment": base64.b64encode(
            json.dumps(assessment_options, ensure_ascii=False).encode("utf-8")
        ).decode("ascii"),
    }
    region = settings.azure_speech_region.strip().lower()
    if not re.fullmatch(r"[a-z0-9-]+", region):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Azure Speech Region 配置无效，请检查后端环境变量。",
        )
    endpoint = (
        f"https://{region}.stt.speech.microsoft.com/"
        "speech/recognition/conversation/cognitiveservices/v1"
    )
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                endpoint,
                params={"language": LOCALE_BY_LANGUAGE[language], "format": "detailed"},
                headers=headers,
                content=audio_bytes,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="语音服务处理超时，请稍后重试。") from exc
    except httpx.RequestError as exc:
        logger.warning("Azure Speech request could not be completed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="暂时无法连接语音评分服务。") from exc

    if response.status_code in {401, 403}:
        logger.error("Azure Speech rejected the configured key or region (HTTP %s).", response.status_code)
        raise HTTPException(status_code=502, detail="语音服务配置无效，请检查 Azure Speech Key 和 Region。")
    if response.status_code >= 400:
        logger.warning("Azure Speech returned HTTP %s.", response.status_code)
        raise HTTPException(status_code=502, detail="语音服务暂时无法完成评分，请稍后重试。")
    try:
        result = response.json()
        best = (result.get("NBest") or [])[0]
        provider_scores = best.get("PronunciationAssessment") or best
    except (ValueError, IndexError, AttributeError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="语音服务未返回可用的评分结果。") from exc

    if result.get("RecognitionStatus") not in {None, "Success", 0, "0"}:
        raise HTTPException(status_code=422, detail="没有识别到清晰的跟读语音，请调整麦克风后重录。")

    pronunciation_score = _score(provider_scores.get("PronScore"), five_point=True)
    recognized_text = str(best.get("Lexical", best.get("Display", "")))[:4000]
    if pronunciation_score is None:
        raise HTTPException(status_code=502, detail="语音服务未返回发音评分，请重新录制后再试。")

    item = SpeechAssessment(
        user_id=current_user.id,
        session_id=session_id,
        language=language,
        reference_text=reference_text,
        recognized_text=recognized_text,
        pronunciation_score=pronunciation_score,
        accuracy_score=_score(provider_scores.get("AccuracyScore")),
        fluency_score=_score(provider_scores.get("FluencyScore")),
        completeness_score=_score(provider_scores.get("CompletenessScore")),
        prosody_score=_score(provider_scores.get("ProsodyScore")),
        words=_word_details(best.get("Words")),
        provider="azure_speech",
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.get("/assessments", response_model=list[SpeechAssessmentPublic])
def list_assessments(
    current_user: CurrentUser,
    session: SessionDep,
    limit: int = Query(default=20, ge=1, le=30),
) -> list[SpeechAssessment]:
    return list(
        session.exec(
            select(SpeechAssessment)
            .where(SpeechAssessment.user_id == current_user.id)
            .order_by(SpeechAssessment.created_at.desc())
            .limit(limit)
        ).all()
    )
