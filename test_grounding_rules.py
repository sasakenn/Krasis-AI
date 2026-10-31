"""全てのAI機能のプロンプトに、根拠・出典のルールが付いていることを確認する。"""
import ai_agents
import course_guide
import grounding_rules as g
import outline
import paper_writer
import study_notes
import task_generator


def _sections():
    return [{"heading": "背景", "purpose": "概要", "literature": []}]


def test_document_prompts_enforce_all_five_rules():
    prompts = [
        paper_writer._build_prompt("題", "問い", _sections(), "", "ja"),
        study_notes._build_prompt("本文", "", "ja"),
    ]
    for prompt in prompts:
        assert g.GROUNDING_RULES_DOCUMENT in prompt
        assert g.CHECK_MARK in prompt and g.VERIFY_MARK in prompt
        assert "3つ挙げる" in prompt


def test_structured_prompts_keep_json_only_and_forbid_invented_sources():
    prompts = [
        outline._build_safe_prompt("テーマ", "法学"),
        task_generator._build_spreadsheet_prompt("表を作る", "ja"),
    ]
    for prompt in prompts:
        assert g.GROUNDING_RULES_STRUCTURED in prompt
        assert "JSONの外に文章を足したり" in prompt
        assert "3つ挙げる" not in prompt  # JSONを壊す末尾の追加文は求めない


def test_chat_prompts_include_chat_rules():
    assert g.GROUNDING_RULES_CHAT in course_guide._build_system_prompt("同志社大学", "文学部", "", "ja")
    assert g.GROUNDING_RULES_CHAT in ai_agents._build_system_prompt("初心者", "学生", "", [], {}, "ja")
