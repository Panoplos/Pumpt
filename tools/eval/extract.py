"""Turns Claude Code session transcripts into an evaluation set for the difficulty model.

For every genuine human prompt: its text, the messages before it in the shape the mod gets from
$.session.messages() ({role, text, toolUses}), and effort proxies for what the prompt cost: seconds
until the next prompt, tool calls, assistant messages and output tokens in between.

Usage: python3 tools/eval/extract.py prompts.json ~/.claude/projects/<project>/*.jsonl
Then label prompts 1-7 in a labels.json ({"<session>#<index>": level}) and run context.mjs.
"""
import json, re, sys
from datetime import datetime

STRIP = [
    r"<system-reminder>.*?</system-reminder>", r"<local-command-caveat>.*?</local-command-caveat>",
    r"<command-name>.*?</command-name>", r"<command-message>.*?</command-message>", r"<command-args>.*?</command-args>",
    r"<local-command-stdout>.*?</local-command-stdout>", r"<task-notification>.*?</task-notification>",
    r"\[SYSTEM NOTIFICATION - NOT USER INPUT\].*", r"<pasted_content[^>]*>.*?</pasted_content[^>]*>",
]


def clean(text):
    for p in STRIP:
        text = re.sub(p, "", text, flags=re.S)
    return text.strip()


def ts(r):
    t = r.get("timestamp")
    return datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() if t else None


def load(path):
    msgs = []
    with open(path) as f:
        for line in f:
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get("type") not in ("user", "assistant") or not isinstance(r.get("message"), dict) or r.get("isSidechain"):
                continue
            m = r["message"]
            content = m.get("content")
            text, tools, has_result = "", [], False
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                parts = []
                for b in content:
                    t = b.get("type")
                    if t == "text":
                        parts.append(b.get("text", ""))
                    elif t == "tool_use":
                        tools.append(b.get("name"))
                    elif t == "tool_result":
                        has_result = True
                text = "\n".join(parts)
            role = m.get("role")
            is_prompt = False
            if role == "user":
                text = clean(text)
                if r.get("isMeta") or has_result:
                    text = ""
                elif text and not text.startswith("[Request interrupted"):
                    is_prompt = True
            usage = m.get("usage") or {}
            msgs.append({"role": role, "text": text, "toolUses": tools, "isPrompt": is_prompt, "ts": ts(r), "outputTokens": usage.get("output_tokens", 0) or 0})
    return msgs


def dataset(path, session):
    msgs = load(path)
    prompts = [i for i, m in enumerate(msgs) if m["isPrompt"]]
    out = []
    for k, i in enumerate(prompts):
        end = prompts[k + 1] if k + 1 < len(prompts) else len(msgs)
        between = msgs[i + 1:end]
        last_ts = max((m["ts"] for m in between if m["ts"]), default=msgs[i]["ts"])
        out.append({
            "session": session, "index": k, "text": msgs[i]["text"],
            "before": [{"role": m["role"], "text": m["text"], "toolUses": m["toolUses"]} for m in msgs[:i]],
            "effort": {
                "seconds": round((last_ts or 0) - (msgs[i]["ts"] or 0)),
                "toolUses": sum(len(m["toolUses"]) for m in between),
                "assistantMsgs": sum(1 for m in between if m["role"] == "assistant"),
                "outputTokens": sum(m["outputTokens"] for m in between),
            },
        })
    return out


rows = []
for path in sys.argv[2:]:
    rows += dataset(path, path.split("/")[-1].split(".")[0][:8])
json.dump(rows, open(sys.argv[1], "w"))
for r in rows:
    e = r["effort"]
    print(f"{r['session']}#{r['index']:<3} {e['seconds']:>6}s {e['toolUses']:>3} tools {e['outputTokens']:>7} out | {r['text'][:90]!r}")
print(len(rows), "prompts")
