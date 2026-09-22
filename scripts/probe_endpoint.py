#!/usr/bin/env python3
"""
Zero-dependency Python Diagnostic Probe for OpenAI-compatible LLM Endpoints.
Tests connectivity, endpoint routes (/v1/chat/completions, /models), and authentication headers.
Uses only Python standard library (urllib, json, ssl, os, sys).
"""

import sys
import os
import json
import ssl
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path

# Disable SSL verification issues if internal enterprise proxy intercepts certs
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


def load_detected_creds():
    """Attempts to auto-read credentials and settings from environment variables and local configs."""
    base_url = (
        os.environ.get("MIKE_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or os.environ.get("POOLSIDE_BASE_URL")
    )
    api_key = (
        os.environ.get("MIKE_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or os.environ.get("POOLSIDE_API_KEY")
    )
    model = (
        os.environ.get("MIKE_MODEL")
        or os.environ.get("OPENAI_MODEL")
        or os.environ.get("POOLSIDE_MODEL")
        or "qwen2.5-coder"
    )

    home = Path.home()
    config_dirs = [
        home / ".config" / "mike",
        home / ".config" / "poolside",
    ]

    for config_dir in config_dirs:
        if not base_url:
            settings_file = config_dir / "settings.yaml"
            if settings_file.exists():
                try:
                    for line in settings_file.read_text(encoding="utf-8").splitlines():
                        line = line.strip()
                        if line.startswith("api_url:") or line.startswith("base_url:"):
                            base_url = line.split(":", 1)[1].strip().strip("\"'")
                        elif (line.startswith("model:") or line.startswith("default_model:")) and model == "qwen2.5-coder":
                            model = line.split(":", 1)[1].strip().strip("\"'")
                except Exception:
                    pass

        if not api_key:
            creds_file = config_dir / "credentials.json"
            if creds_file.exists():
                try:
                    data = json.loads(creds_file.read_text(encoding="utf-8"))
                    api_key = data.get("access_token") or data.get("api_key") or data.get("token") or data.get("key")
                except Exception:
                    pass

    return base_url or "http://localhost:11434/v1", api_key or "", model


def send_probe(url, headers, payload):
    """Sends a single HTTP POST request and returns (status_code, response_body_text)"""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, body
    except Exception as e:
        return 0, str(e)


def send_get_probe(url, headers):
    """Sends a single HTTP GET request (useful for testing /models list)"""
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, body
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, body
    except Exception as e:
        return 0, str(e)


def main():
    if "--help" in sys.argv or "-h" in sys.argv:
        print("Usage: python probe_endpoint.py [BASE_URL] [API_KEY] [MODEL]")
        print("Examples:")
        print("  python probe_endpoint.py http://localhost:11434/v1 '' qwen2.5-coder")
        print("  python probe_endpoint.py https://api.openai.com/v1 sk-xxxx gpt-4o")
        sys.exit(0)

    print("=" * 70)
    print("🔍 M.I.K.E. - LLM Endpoint Diagnostic Probe")
    print("=" * 70)

    auto_base, auto_key, auto_model = load_detected_creds()

    base_url = sys.argv[1] if len(sys.argv) > 1 else auto_base
    api_key = sys.argv[2] if len(sys.argv) > 2 else auto_key
    model = sys.argv[3] if len(sys.argv) > 3 else auto_model

    base_url = base_url.strip().rstrip("/")
    if not base_url.startswith("http://") and not base_url.startswith("https://"):
        base_url = f"http://{base_url}"

    parsed = urllib.parse.urlparse(base_url)
    root_url = f"{parsed.scheme}://{parsed.netloc}"

    print(f"[*] Target Host : {root_url}")
    print(f"[*] Base URL    : {base_url}")
    print(f"[*] API Key     : {'*' * (len(api_key) - 6) + api_key[-6:] if api_key and len(api_key) > 6 else (api_key or '(None / Local)')}")
    print(f"[*] Model Name  : {model}")
    print("-" * 70)

    candidate_paths = [
        "/v1/chat/completions",
        "/openai/v1/chat/completions",
        "/api/v1/chat/completions",
        "/chat/completions",
        "/v1/models",
        "/models"
    ]

    urls_to_test = []
    if base_url != root_url:
        urls_to_test.append(f"{base_url}/chat/completions")
        urls_to_test.append(f"{base_url}/models")

    for path in candidate_paths:
        full = f"{root_url}{path}"
        if full not in urls_to_test:
            urls_to_test.append(full)

    auth_styles = [
        ("Bearer Token", {"Authorization": f"Bearer {api_key}" if api_key else ""}),
        ("X-API-Key", {"X-API-Key": api_key if api_key else ""}),
        ("api-key", {"api-key": api_key if api_key else ""}),
        ("Poolside-Token", {"Poolside-Token": api_key if api_key else ""}),
        ("No Auth (Local)", {})
    ]

    working_config = None

    for target_url in urls_to_test:
        is_get = target_url.endswith("/models")
        method_str = "GET" if is_get else "POST"
        print(f"\n[+] Testing {method_str}: {target_url}")

        for auth_name, auth_header in auth_styles:
            # Skip empty auth if api_key was provided and this is 'No Auth'
            if api_key and auth_name == "No Auth (Local)":
                continue
            # Skip named token variants if no api_key was provided
            if not api_key and auth_name != "No Auth (Local)":
                continue

            headers = {
                "Content-Type": "application/json",
                **{k: v for k, v in auth_header.items() if v}
            }

            if is_get:
                status, body = send_get_probe(target_url, headers)
            else:
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": "hello"}],
                    "max_tokens": 10,
                    "stream": False
                }
                status, body = send_probe(target_url, headers, payload)

            preview = body.strip().replace("\n", " ")[:110]

            if status == 200:
                print(f"    \033[92m✔ [{auth_name}] HTTP {status} (SUCCESS!)\033[0m")
                print(f"      Response: {preview}")
                if not working_config:
                    working_config = {
                        "url": target_url,
                        "auth": auth_name,
                        "status": status,
                        "response": preview
                    }
            elif status in (401, 403):
                print(f"    \033[93m⚠ [{auth_name}] HTTP {status} (Auth Error - Key rejected)\033[0m -> {preview}")
            elif status == 405:
                print(f"    \033[91m✖ [{auth_name}] HTTP {status} (Method Not Allowed)\033[0m")
            elif status == 404:
                print(f"    \033[90m- [{auth_name}] HTTP {status} (Path Not Found)\033[0m")
            else:
                print(f"    \033[94m? [{auth_name}] HTTP {status}\033[0m -> {preview}")

    print("\n" + "=" * 70)
    if working_config:
        print("\033[92m🎉 WORKING ENDPOINT FOUND!\033[0m")
        print(f"   Target URL : {working_config['url']}")
        print(f"   Auth Header: {working_config['auth']}")
        print(f"   Model Name : {model}")
        print("\n👉 Configure in M.I.K.E. (⚙️ Config):")
        configured_base = working_config['url'].replace('/chat/completions', '').replace('/models', '')
        print(f"   Base URL : {configured_base}")
        print(f"   Model    : {model}")
    else:
        print("\033[91m❌ No endpoint returned HTTP 200.\033[0m")
        print("Review the status codes above to see if paths returned 401 (Auth issue) vs 404/405 (Path issue) or connection refused.")
    print("=" * 70)


if __name__ == "__main__":
    main()
