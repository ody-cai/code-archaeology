#!/usr/bin/env python3
"""只读读取已落盘的 GitHub 原始响应，抽取可核验事实，输出 verification-facts.json。"""
import base64, hashlib, json, os, pathlib, datetime

RAW = pathlib.Path(__file__).parent / "raw"
OUT = pathlib.Path(__file__).parent / "verification-facts.json"

def load(name):
    p = RAW / name
    b = p.read_bytes()
    return json.loads(b.decode("utf-8")), b

def sha256file(name):
    return hashlib.sha256((RAW / name).read_bytes()).hexdigest()

facts = {"generated_utc": datetime.datetime.now(datetime.timezone.utc)
         .strftime("%Y-%m-%dT%H:%M:%SZ"), "cases": []}

# ---------- 案例 A：仓库元数据 ----------
for repo_file, label in [("chalk-repo.json", "chalk/chalk"),
                         ("oa-repo.json", "ody-cai/oa-system")]:
    d, b = load(repo_file)
    facts["cases"].append({
        "case": f"A-{label}",
        "claim": f"仓库 {label} 的基本元数据（星标 / 语言 / 默认分支 / 体积）",
        "source_file": repo_file,
        "sha256_response": sha256file(repo_file),
        "response_bytes": len(b),
        "evidence": {
            "full_name": d.get("full_name"),
            "html_url": d.get("html_url"),
            "id": d.get("id"),
            "stargazers_count": d.get("stargazers_count"),
            "forks_count": d.get("forks_count"),
            "language": d.get("language"),
            "default_branch": d.get("default_branch"),
            "size_kb": d.get("size"),
            "open_issues_count": d.get("open_issues_count"),
            "created_at": d.get("created_at"),
            "pushed_at": d.get("pushed_at"),
            "license": (d.get("license") or {}).get("spdx_id"),
            "archived": d.get("archived"),
        },
    })

# ---------- 案例 B：提交父子关系（旧版本「被放弃的尝试」判定的核心依据） ----------
c572, _ = load("chalk-commit-5729845.json")
c4c3, _ = load("chalk-commit-4c304dd.json")

def commit_digest(d):
    return {
        "sha": d.get("sha"),
        "message_head": (d.get("commit", {}).get("message") or "").split("\n")[0],
        "author_date": (d.get("commit", {}).get("author") or {}).get("date"),
        "parents": [p.get("sha") for p in d.get("parents", [])],
        "additions": (d.get("stats") or {}).get("additions"),
        "deletions": (d.get("stats") or {}).get("deletions"),
        "files_changed": len(d.get("files") or []),
        "files": [f.get("filename") for f in (d.get("files") or [])],
    }

a, bb = commit_digest(c4c3), commit_digest(c572)
direct_parent = bb["sha"] in [p[:7] for p in [a["sha"]]] or a["sha"] in bb["parents"]
facts["cases"].append({
    "case": "B-父子链",
    "claim": "chalk 提交 5729845 的直接父提交是否就是 4c304dd"
             "（若是，则旧算法把「连续两次提交」误判为「被放弃的尝试」）",
    "source_file": "chalk-commit-5729845.json + chalk-commit-4c304dd.json",
    "sha256_response": [sha256file("chalk-commit-5729845.json"),
                        sha256file("chalk-commit-4c304dd.json")],
    "commit_4c304dd": a,
    "commit_5729845": bb,
    "computed": {
        "5729845_parents": bb["parents"],
        "4c304dd_full_sha": a["sha"],
        "is_direct_child": a["sha"] in bb["parents"],
        "gap_seconds": None,
    },
})

# 时间差
from datetime import datetime as dt
fmt = "%Y-%m-%dT%H:%M:%SZ"
try:
    t1 = dt.strptime(a["author_date"], fmt)
    t2 = dt.strptime(bb["author_date"], fmt)
    facts["cases"][-1]["computed"]["gap_seconds"] = int((t2 - t1).total_seconds())
except Exception as e:
    facts["cases"][-1]["computed"]["gap_seconds"] = f"ERR {e}"

# ---------- 案例 C：文件内容行级核验 ----------
d, b = load("chalk-index-js.json")
content = base64.b64decode(d.get("content", "")).decode("utf-8", "replace")
lines = content.split("\n")
hit = [(i + 1, l.strip()) for i, l in enumerate(lines)
       if "capitalizedModel" in l or ("underlineColor" in l)]
facts["cases"].append({
    "case": "C-行级存在性",
    "claim": "chalk main 分支 source/index.js 中是否仍然存在 underline+capitalizedModel 的实现"
             "（用于判定该补丁到底有没有被回滚）",
    "source_file": "chalk-index-js.json",
    "sha256_response": sha256file("chalk-index-js.json"),
    "computed": {
        "content_sha_git_blob": d.get("sha"),
        "file_size_bytes": d.get("size"),
        "total_lines": len(lines),
        "sha256_decoded_file": hashlib.sha256(content.encode()).hexdigest(),
        "matched_lines": hit,
        "line_115": lines[114].strip() if len(lines) >= 115 else None,
    },
})

# ---------- 案例 D：oa-system 提交史抽样 ----------
d, b = load("oa-commits.json")
commits = [{
    "sha": c.get("sha"),
    "date": (c.get("commit", {}).get("author") or {}).get("date"),
    "author": ((c.get("commit", {}).get("author") or {}).get("name")),
    "message": (c.get("commit", {}).get("message") or "").split("\n")[0],
} for c in d]
bots = [c for c in commits if "bot" in (c["author"] or "").lower()
        or "[bot]" in (c["message"] or "").lower()
        or "dependabot" in (c["message"] or "").lower()]
facts["cases"].append({
    "case": "D-提交史与信噪比",
    "claim": "ody-cai/oa-system 最近提交的作者构成（用于交叉核对工具给出的信噪比）",
    "source_file": "oa-commits.json",
    "sha256_response": sha256file("oa-commits.json"),
    "computed": {
        "sample_size": len(commits),
        "range": [commits[-1]["date"] if commits else None,
                  commits[0]["date"] if commits else None],
        "bot_like_count": len(bots),
        "bot_ratio": round(len(bots) / len(commits), 4) if commits else None,
        "bot_commits_sample": bots[:10],
        "head_commit": commits[0] if commits else None,
        "distinct_authors": sorted({c["author"] for c in commits if c["author"]}),
    },
    "first_10": commits[:10],
})

OUT.write_text(json.dumps(facts, ensure_ascii=False, indent=2), encoding="utf-8")
print(OUT)
print(json.dumps(facts, ensure_ascii=False, indent=2)[:4000])
