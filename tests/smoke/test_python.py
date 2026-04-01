
import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
ENGINE_PATH = REPO_ROOT / "evolution_engine.py"

def test_evolve():
    dummy_data = [
        {
            "url": "https://en.wikipedia.org/wiki/Python_(programming_language)",
            "title": "Python (programming_language) - Wikipedia",
            "content": "Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability with the use of significant indentation.",
            "searchProvider": "wikipedia"
        },
        {
            "url": "https://www.python.org/",
            "title": "Welcome to Python.org",
            "content": "The official home of the Python Programming Language.",
            "searchProvider": "google"
        }
    ]
    
    process = subprocess.Popen(
        [sys.executable, str(ENGINE_PATH), "evolve", "python"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=REPO_ROOT,
    )
    
    stdout, stderr = process.communicate(input=json.dumps(dummy_data))
    
    print("STDOUT:", stdout)
    print("STDERR:", stderr)
    print("CODE:", process.returncode)

if __name__ == "__main__":
    test_evolve()
