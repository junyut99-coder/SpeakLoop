from typing import Any


SCENARIOS: list[dict[str, Any]] = [
    {"key": "cafe-order", "title": "在咖啡店点单", "level": "beginner", "category": "日常生活 · 礼貌表达", "description": "练习点饮品、选择杯型和冷热。"},
    {"key": "self-introduction", "title": "第一次自我介绍", "level": "beginner", "category": "日常交流 · 认识新朋友", "description": "用简单自然的句子介绍自己。"},
    {"key": "ask-directions", "title": "问路去地铁站", "level": "beginner", "category": "城市出行 · 问路指引", "description": "询问方向并确认步行路线。"},
    {"key": "project-interview", "title": "面试中的项目介绍", "level": "intermediate", "category": "职场沟通 · 求职面试", "description": "介绍负责过的项目和具体成果。"},
    {"key": "hotel-booking", "title": "酒店预订出了问题", "level": "intermediate", "category": "旅行沟通 · 解决问题", "description": "礼貌说明订单问题并提出需求。"},
    {"key": "team-meeting", "title": "主持团队周会", "level": "intermediate", "category": "职场沟通 · 会议表达", "description": "汇报进展、询问阻碍并安排下一步。"},
    {"key": "product-presentation", "title": "向客户介绍产品", "level": "advanced", "category": "商务交流 · 产品演示", "description": "根据客户需求说明产品价值。"},
    {"key": "cross-team-alignment", "title": "协调跨部门分歧", "level": "advanced", "category": "职场沟通 · 协商合作", "description": "表达不同看法并推动双方达成共识。"},
    {"key": "delivery-negotiation", "title": "谈判项目交付期限", "level": "advanced", "category": "商务交流 · 方案协商", "description": "说明限制条件并协商可执行的时间表。"},
]

LANGUAGE_NAMES = {"en": "英语", "ja": "日语", "zh": "普通话"}
LEVEL_NAMES = {"beginner": "初级", "intermediate": "中级", "advanced": "高级"}


def find_scenario(key_or_title: str) -> dict[str, Any] | None:
    return next(
        (scenario for scenario in SCENARIOS if key_or_title in {scenario["key"], scenario["title"]}),
        None,
    )
