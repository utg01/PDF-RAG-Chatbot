# DocRAG // PDF RAG Workbench with Caching and Reranking

A high-performance technical document question-answering system using retrieval-augmented generation (RAG) with MMR retrieval, BGE reranking and query caching.

---

## Key Highlights

- **Recruiter Quick Start (Instant Demo):** Pre-embedded with the 23-page *OmniScale Cloud SRE Incident Response Handbook*. No need to search for a PDF or wait for vector embeddings to generate—evaluators can click once and test immediately.
- **Embedded Document Viewer:** Recruiters can inspect or download the source PDF directly in-app to verify retrieval accuracy and faithfulness against the source text.
- **Unified Single Deployment:** Zero separate frontend builds (no Node.js/Vercel overhead). A lightweight ASGI web server (Starlette + Uvicorn) serves both the static web UI and the streaming API in a single process.
- **Multi-Stage Retrieval:** Mistral embeddings (`1024-dim`), Pinecone serverless MMR search, Pinecone-hosted `bge-reranker-v2-m3` reranking, and semantic query caching (`>0.85` similarity threshold).
- **Streaming Responses:** Token-by-token Server-Sent Events (SSE) streaming with live time-to-first-token (TTFT) and latency metrics powered by Groq (`openai/gpt-oss-120b`).

---

## Architecture & Tech Stack

```
[User Browser]
       │
       ▼ (Single Deployment / Sub-10ms UI)
[Starlette / Uvicorn Server]
       ├── GET  /               -> Clean Web UI (HTML5 / CSS / Vanilla JS)
       ├── GET  /api/sample     -> Instant pre-embedded index connection
       ├── GET  /api/pdf/sample -> Direct PDF file viewer & download
       ├── POST /api/upload     -> Ingestion pipeline for custom PDFs
       └── POST /api/chat       -> SSE Streaming LangGraph Agent
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
        [Pinecone Serverless Index]             [Groq GPT-OSS-120B]
        • Mistral 1024-dim embeddings           • LangGraph StateGraph
        • MMR Retrieval (fetch_k=10, k=5)       • Tool calling agent
        • BGE Reranker v2 M3 (top 3)            • Grounded generation
        • Semantic Query Cache (>0.85)
```

- **Backend & Serving:** Starlette, Uvicorn, LangGraph, LangChain.
- **Vector DB & Reranking:** Pinecone (`aws/us-east-1`), `bge-reranker-v2-m3`.
- **Embeddings:** Mistral AI (`mistral-embed`, 1024 dimensions).
- **LLM:** Groq API (`openai/gpt-oss-120b`).
- **Frontend:** Vanilla HTML5, CSS3, ES6 JavaScript (Zero npm dependencies, zero build step).

---

## Quick Start

### 1. Environment Setup

Create a `.env` file in the project root with the following API keys:

```bash
PINECONE_API_KEY="your-pinecone-api-key"
MISTRAL_API_KEY="your-mistral-api-key"
GROQ_API_KEY="your-groq-api-key"
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Run Application

```bash
python app.py
```

The web server starts at `http://localhost:8000`.

---

## Recruiter Evaluation Guide

1. Open `http://localhost:8000` in any web browser.
2. In the **Recruiter Quick Start** card, click **"Start demo with sample PDF"** (or click any of the suggested query pills).
3. The interface connects instantly to the pre-indexed Pinecone database (`114` chunks) with **zero wait time**.
4. Test with sample queries:
   - *"What are the severity levels for incidents in this handbook?"*
   - *"What is the SLO and error budget policy?"*
   - *"Summarize the Tier-1 incident response procedure."*
   - *"Describe the automated failover architecture."*
5. Click **"View PDF"** in the top navigation bar to open the embedded PDF viewer and compare the model's answer side-by-side with the source document.
6. Test custom documents anytime by clicking **"Change document"** and dropping in any text-based PDF.

---

## Single Deployment Guide

Because the application is packaged as a unified ASGI app without separate frontend microservices, it deploys to any cloud platform with a single command and minimal resource overhead:

### Deploying on Render / Railway / Fly.io

- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `python app.py` (or `uvicorn app:app --host 0.0.0.0 --port $PORT`)
- **Environment Variables:** Set `PINECONE_API_KEY`, `MISTRAL_API_KEY`, and `GROQ_API_KEY`.

---

## RAGAS Evaluation Results

A 47-question RAGAS evaluation was executed comparing the baseline vs. advanced reranked pipeline on the Cloud SRE handbook:

| Metric | Baseline | Advanced (MMR + BGE Reranker) | Improvement |
|---|---|---|---|
| **Faithfulness** | 0.7815 | **0.8082** | +0.0267 |
| **Answer Relevancy** | 0.8085 | **0.8447** | +0.0361 |
| **Context Precision** | 0.8278 | **0.9345** | **+0.1067** |
| **Context Recall** | 0.8444 | **0.8849** | +0.0405 |

*Context Precision improved by +10.6% due to BGE reranking eliminating irrelevant chunks before passing context to Groq.*
