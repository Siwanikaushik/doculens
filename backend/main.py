import io
import os
import json
import re
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from pypdf import PdfReader

load_dotenv()

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024  # 15 MB
ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md"}

app = FastAPI(title="DocuLens API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DOCUMENTS_STORE: dict[str, dict[str, Any]] = {}

DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(exist_ok=True)
STORE_FILE = DATA_DIR / "documents_store.json"


def save_store() -> None:
    STORE_FILE.write_text(
        json.dumps(DOCUMENTS_STORE, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def load_store() -> None:
    if STORE_FILE.exists():
        try:
            loaded = json.loads(STORE_FILE.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                DOCUMENTS_STORE.update(loaded)
        except Exception:
            pass


load_store()
class AskRequest(BaseModel):
    doc_id: str = Field(..., min_length=1)
    question: str = Field(..., min_length=2)


class CitationItem(BaseModel):
    chunk_id: str
    page: int
    quote: str


class AskResponse(BaseModel):
    answer: str
    is_supported: bool
    citations: list[CitationItem]


def extract_pages(filename: str, content: bytes) -> list[dict[str, Any]]:
    ext = Path(filename).suffix.lower()
    pages: list[dict[str, Any]] = []

    if ext == ".pdf":
        reader = PdfReader(io.BytesIO(content))
        for idx, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or "").strip()
            if text:
                pages.append({"page": idx, "text": text})
    else:
        text = content.decode("utf-8", errors="replace").strip()
        if text:
            pages.append({"page": 1, "text": text})

    return pages


def chunk_pages(
    doc_id: str,
    filename: str,
    pages: list[dict[str, Any]],
    chunk_size: int = 700,
    overlap: int = 120,
) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    chunk_counter = 0

    for item in pages:
        page_num = item["page"]
        text = " ".join(item["text"].split())
        start = 0
        text_len = len(text)

        while start < text_len:
            end = min(start + chunk_size, text_len)
            snippet = text[start:end].strip()
            if snippet:
                chunks.append(
                    {
                        "chunk_id": f"{doc_id}_c{chunk_counter}",
                        "doc_id": doc_id,
                        "filename": filename,
                        "page": page_num,
                        "text": snippet,
                    }
                )
                chunk_counter += 1
            if end >= text_len:
                break
            start = max(end - overlap, start + 1)

    return chunks


def tokenize(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9\-]+", text.lower())
    return {w for w in words if len(w) > 2}


def retrieve_top_chunks(
    question: str, chunks: list[dict[str, Any]], top_k: int = 4
) -> list[dict[str, Any]]:
    q_tokens = tokenize(question)
    if not q_tokens:
        return chunks[:top_k]

    scored: list[tuple[int, dict[str, Any]]] = []
    for chunk in chunks:
        c_tokens = tokenize(chunk["text"])
        overlap_score = len(q_tokens & c_tokens)
        scored.append((overlap_score, chunk))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    top_matches = [chunk for score, chunk in scored[:top_k] if score > 0]
    return top_matches if top_matches else chunks[: min(top_k, len(chunks))]


def ask_gemini_grounded(question: str, chunks: list[dict[str, Any]]) -> AskResponse:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500, detail="GEMINI_API_KEY is not set in backend/.env"
        )

    context_blocks = "\n\n".join(
        f"[chunk_id: {c['chunk_id']} | page: {c['page']}]\n{c['text']}"
        for c in chunks
    )

    prompt = f"""
You are DocuLens, a strict document Q&A assistant.
Answer the user's question using ONLY the provided document excerpts below.
Do not guess or use outside knowledge.
If the provided excerpts do not contain enough information to answer, set "is_supported" to false, explain clearly that the document does not mention it, and return an empty "citations" list.
When "is_supported" is true, include exact short quotes and the matching "chunk_id" and "page" in "citations".

Question:
{question}

Document Excerpts:
{context_blocks}
""".strip()

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-3.8-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.1,
            response_mime_type="application/json",
            response_schema=AskResponse,
        ),
    )

    if not response.text:
        raise HTTPException(status_code=502, detail="Empty response from Gemini.")

    return AskResponse.model_validate_json(response.text)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "gemini_key_configured": str(bool(os.getenv("GEMINI_API_KEY"))).lower(),
    }


@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename.")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 15 MB limit.")

    pages = extract_pages(file.filename, content)
    if not pages:
        raise HTTPException(
            status_code=422,
            detail="Could not extract readable text from file (scanned image PDFs without OCR are not supported).",
        )

    doc_id = str(uuid.uuid4())[:8]
    saved_path = UPLOAD_DIR / f"{doc_id}_{Path(file.filename).name}"
    saved_path.write_bytes(content)

    chunks = chunk_pages(doc_id=doc_id, filename=file.filename, pages=pages)
    DOCUMENTS_STORE[doc_id] = {
        "doc_id": doc_id,
        "filename": file.filename,
        "page_count": len(pages),
        "chunk_count": len(chunks),
        "chunks": chunks,
    }
    save_store()

    return {
        "doc_id": doc_id,
        "filename": file.filename,
        "page_count": len(pages),
        "chunk_count": len(chunks),
        "sample_chunk": chunks[0] if chunks else None,
    }


@app.get("/api/documents")
def list_documents() -> list[dict[str, Any]]:
    return [
        {
            "doc_id": doc["doc_id"],
            "filename": doc["filename"],
            "page_count": doc["page_count"],
            "chunk_count": doc["chunk_count"],
        }
        for doc in DOCUMENTS_STORE.values()
    ]
@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str):
    if doc_id not in DOCUMENTS_STORE:
        raise HTTPException(status_code=404, detail="Document not found.")
    del DOCUMENTS_STORE[doc_id]
    save_store()
    return {"deleted": doc_id}

@app.post("/api/ask", response_model=AskResponse)
def ask_question(payload: AskRequest) -> AskResponse:
    doc = DOCUMENTS_STORE.get(payload.doc_id)
    if not doc:
        raise HTTPException(
            status_code=404, detail=f"Document '{payload.doc_id}' not found."
        )

    relevant_chunks = retrieve_top_chunks(payload.question, doc["chunks"], top_k=4)
    return ask_gemini_grounded(payload.question, relevant_chunks)