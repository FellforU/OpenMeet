"""Tests for summary and transcript quality evaluators."""

import pytest
from asr_service.evaluation.summary_evaluator import (
    SummaryEvaluator,
    ReferenceSummary,
    _extract_keywords,
)
from asr_service.evaluation.transcript_evaluator import TranscriptEvaluator


# --- Summary evaluator tests ---

@pytest.fixture
def evaluator():
    return SummaryEvaluator()


@pytest.fixture
def reference():
    return ReferenceSummary(
        topics=["服务器迁移计划", "模块修复进度", "云服务成本对比"],
        action_items=["修复training模块", "修复事件管理模块", "提交UI修复"],
        key_data=["100-200美金", "本周完成"],
        conclusions=["本周完成修复达到beta版本"],
    )


def test_evaluate_perfect_coverage(evaluator, reference):
    generated = {
        "topic": "服务器迁移与模块修复讨论",
        "conclusions": ["本周完成所有模块修复，达到beta版本"],
        "action_items": [
            {"task": "修复training模块"},
            {"task": "修复事件管理模块"},
            {"task": "提交三个UI修复"},
        ],
        "discussion": [
            {"topic": "服务器迁移计划", "summary": "从微软迁移到谷歌云"},
            {"topic": "模块修复进度", "summary": "本周完成修复"},
            {"topic": "云服务成本对比", "summary": "100-200美金每月"},
        ],
        "key_data": ["100-200美金/月", "本周完成所有修复"],
    }
    result = evaluator.evaluate(generated, reference)
    assert result.topic_coverage >= 0.8
    assert result.action_item_recall >= 0.6
    assert result.key_data_recall >= 0.5
    assert result.overall_score > 0.5


def test_evaluate_empty_generated(evaluator, reference):
    generated = {
        "topic": "",
        "conclusions": [],
        "action_items": [],
        "discussion": [],
    }
    result = evaluator.evaluate(generated, reference)
    assert result.topic_coverage == 0.0
    assert result.action_item_recall == 0.0
    assert result.structural_score == 0.0


def test_evaluate_no_reference():
    evaluator = SummaryEvaluator()
    empty_ref = ReferenceSummary()
    generated = {"topic": "test", "conclusions": ["c1"], "action_items": [], "discussion": []}
    result = evaluator.evaluate(generated, empty_ref)
    # All reference scores should be 1.0 when no reference to compare
    assert result.topic_coverage == 1.0
    assert result.action_item_recall == 1.0


def test_evaluate_structural_score(evaluator):
    generated = {
        "topic": "主题",
        "conclusions": ["结论"],
        "action_items": [{"task": "任务"}],
        "discussion": [{"topic": "话题", "summary": "摘要"}],
        "key_data": ["数据"],
    }
    ref = ReferenceSummary()
    result = evaluator.evaluate(generated, ref)
    assert result.structural_score == 1.0


def test_evaluate_from_transcript(evaluator):
    generated = {
        "topic": "项目讨论",
        "conclusions": ["完成修复"],
        "action_items": [{"task": "修复模块"}],
        "discussion": [{"topic": "进度", "summary": "本周完成100美金预算"}],
        "key_data": ["100美金"],
    }
    transcript = "我们要修复这个模块，预算大概100美金一个月"
    result = evaluator.evaluate_from_transcript(generated, transcript)
    assert result.overall_score > 0


# --- Keyword extraction tests ---

def test_extract_keywords():
    keywords = _extract_keywords("服务器迁移计划和谷歌云平台部署")
    # Should extract multi-char Chinese tokens
    assert len(keywords) > 0
    assert "的" not in keywords


def test_extract_keywords_english():
    keywords = _extract_keywords("server migration plan 2024")
    assert "server" in keywords
    assert "2024" in keywords


# --- Transcript evaluator tests ---

@pytest.fixture
def transcript_eval():
    return TranscriptEvaluator()


def test_transcript_eval_clean_text(transcript_eval):
    result = transcript_eval.evaluate("今天我们讨论项目进展，一切顺利。", "zh")
    assert result.readability_score > 0.7
    assert result.filler_density < 0.1
    assert result.hallucination_count == 0


def test_transcript_eval_filler_heavy(transcript_eval):
    result = transcript_eval.evaluate("呃嗯呃嗯呃嗯啊啊啊那个那个就是就是", "zh")
    assert result.filler_density > 0.3
    assert result.readability_score < 0.7


def test_transcript_eval_repetitions(transcript_eval):
    result = transcript_eval.evaluate("好好好好好好好好好好好好", "zh")
    assert result.repetition_density > 0


def test_transcript_eval_hallucinations(transcript_eval):
    result = transcript_eval.evaluate("请订阅我的频道，感谢观看", "zh")
    assert result.hallucination_count >= 1


def test_transcript_eval_number_issues(transcript_eval):
    result = transcript_eval.evaluate("1个月大概3到5年这样子", "zh")
    assert result.number_issues > 0


def test_transcript_eval_empty(transcript_eval):
    result = transcript_eval.evaluate("", "zh")
    assert result.overall_score == 0.0


def test_transcript_compare(transcript_eval):
    text_a = "呃嗯那个就是说我们1个月的费用"
    text_b = "我们一个月的费用"
    comparison = transcript_eval.compare(text_a, text_b, "zh")
    assert comparison["winner"] == "B"
    assert comparison["text_b"]["readability"] > comparison["text_a"]["readability"]
