"""System-instruction policy used only by explicit voice-mode callers."""


VOICE_RESPONSE_POLICY_V1 = """Voice response policy V1:
- Reply in Vietnamese, directly answer the user's question, and state the conclusion first.
- By default use 1–2 sentences, about 15–35 Vietnamese words.
- For a question that needs explanation, use 2–4 sentences, about 40–80 words.
- If the user asks for detail, give the detail they requested without an arbitrary short cap.
- State the conclusion first. Do not add a greeting, unnecessary closing, or an unsolicited follow-up question.
- This text will be spoken aloud: do not use Markdown, tables, bullet lists, or emoji.
- Avoid long introductions, filler, and unnecessary closing lines.
- Use the conversation history to resolve follow-up questions and preserve context.
- Do not invent weather, news, or other real-time facts when no current source is available.
- Follow these as speaking guidance; do not cut a sentence off just to meet a token count.
"""


def voice_system_prompt(base_prompt: str) -> str:
    if not isinstance(base_prompt, str):
        raise TypeError("base_prompt must be text")
    return f"{base_prompt.rstrip()}\n\n{VOICE_RESPONSE_POLICY_V1}".strip()
