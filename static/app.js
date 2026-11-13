/**
 * DocRAG Workbench Frontend Application
 * Lightweight vanilla JavaScript with Server-Sent Events (SSE) streaming,
 * instant recruiter pre-embedded PDF testing, and inline document preview.
 */

(function () {
  'use strict';

  // --- STATE ---
  const state = {
    sessionId: null,
    indexName: null,
    fileName: null,
    isSample: false,
    isStreaming: false
  };

  // --- DOM ELEMENTS ---
  const el = {
    // Views
    landingView: document.getElementById('view-landing'),
    chatView: document.getElementById('view-chat'),

    // Header items
    headerDocBadge: document.getElementById('header-doc-badge'),
    headerDocName: document.getElementById('header-doc-name'),
    headerDocType: document.getElementById('header-doc-type'),
    btnViewPdf: document.getElementById('btn-view-pdf'),
    btnDownloadPdf: document.getElementById('btn-download-pdf'),
    btnSwitchDoc: document.getElementById('btn-switch-doc'),

    // Landing items
    btnStartSample: document.getElementById('btn-start-sample'),
    btnPreviewSample: document.getElementById('btn-preview-sample'),
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    uploadStatus: document.getElementById('upload-status'),
    uploadStatusText: document.getElementById('upload-status-text'),
    sampleQueries: document.querySelectorAll('.sample-query-item'),

    // Chat items
    sidebarDocTitle: document.getElementById('sidebar-doc-title'),
    sidebarDocMeta: document.getElementById('sidebar-doc-meta'),
    sidebarBtnView: document.getElementById('sidebar-btn-view'),
    btnNewChat: document.getElementById('btn-new-chat'),
    quickPromptBtns: document.querySelectorAll('.quick-prompt-btn'),
    messagesContainer: document.getElementById('messages-container'),
    welcomeDocName: document.getElementById('welcome-doc-name'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    btnSend: document.getElementById('btn-send'),

    // Modal
    pdfModal: document.getElementById('pdf-modal'),
    modalDocTitle: document.getElementById('modal-doc-title'),
    modalExternalLink: document.getElementById('modal-external-link'),
    modalBtnClose: document.getElementById('modal-btn-close'),
    pdfViewerFrame: document.getElementById('pdf-viewer-frame')
  };

  // --- UTILS ---
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function renderMarkdown(text) {
    if (typeof marked !== 'undefined' && marked.parse) {
      return marked.parse(text);
    }
    // Fallback minimal formatting
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '<p></p>')
      .replace(/\n/g, '<br>');
  }

  function scrollToBottom() {
    el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
  }

  // --- VIEW TRANSITIONS ---
  function showLandingView() {
    el.landingView.classList.remove('hidden');
    el.chatView.classList.add('hidden');
    el.headerDocBadge.classList.add('hidden');
    el.btnViewPdf.classList.add('hidden');
    el.btnDownloadPdf.classList.add('hidden');
    el.btnSwitchDoc.classList.add('hidden');
  }

  function showChatView() {
    el.landingView.classList.add('hidden');
    el.chatView.classList.remove('hidden');
    el.headerDocBadge.classList.remove('hidden');
    el.btnViewPdf.classList.remove('hidden');
    el.btnDownloadPdf.classList.remove('hidden');
    el.btnSwitchDoc.classList.remove('hidden');

    // Update header & sidebar labels
    el.headerDocName.textContent = state.fileName;
    el.sidebarDocTitle.textContent = state.fileName;
    el.welcomeDocName.textContent = state.fileName;

    if (state.isSample) {
      el.headerDocType.textContent = 'Pre-embedded';
      el.headerDocType.className = 'badge';
      el.sidebarDocMeta.textContent = '114 chunks · Pre-embedded';
      el.btnDownloadPdf.href = '/api/pdf/sample';
      el.modalExternalLink.href = '/api/pdf/sample';
    } else {
      el.headerDocType.textContent = 'Custom Index';
      el.headerDocType.className = 'badge';
      el.sidebarDocMeta.textContent = 'Temporary Pinecone Index';
      const pdfUrl = state.sessionId ? `/api/pdf/session/${state.sessionId}` : '#';
      el.btnDownloadPdf.href = pdfUrl;
      el.modalExternalLink.href = pdfUrl;
    }

    el.chatInput.focus();
  }

  // --- PDF VIEWER MODAL ---
  function openPdfViewer() {
    const url = state.isSample ? '/api/pdf/sample' : (state.sessionId ? `/api/pdf/session/${state.sessionId}` : '/api/pdf/sample');
    el.modalDocTitle.textContent = state.fileName || 'Cloud SRE Handbook';
    el.modalExternalLink.href = url;
    el.pdfViewerFrame.src = url;
    el.pdfModal.classList.remove('hidden');
  }

  function closePdfViewer() {
    el.pdfModal.classList.add('hidden');
    el.pdfViewerFrame.src = '';
  }

  // --- INITIALIZE PRE-EMBEDDED SAMPLE (RECRUITER QUICK START) ---
  async function activateSamplePdf(autoSendQuery = null) {
    try {
      el.btnStartSample.disabled = true;
      el.btnStartSample.innerHTML = '<span class="spinner"></span> Connecting...';

      const res = await fetch('/api/sample');
      const data = await res.json();

      if (data.status === 'success') {
        state.sessionId = data.session_id || generateUUID();
        state.indexName = data.index_name;
        state.fileName = data.file_name;
        state.isSample = true;

        showChatView();

        if (autoSendQuery) {
          el.chatInput.value = autoSendQuery;
          submitChat();
        }
      } else {
        alert('Failed to connect to sample PDF: ' + (data.message || 'Unknown error'));
      }
    } catch (err) {
      alert('Error activating sample PDF: ' + err.message);
    } finally {
      el.btnStartSample.disabled = false;
      el.btnStartSample.innerHTML = '<span>Start demo with sample PDF</span><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
    }
  }

  // --- FILE UPLOAD (CUSTOM PDF AS TEMPFILE) ---
  async function handleFileUpload(file) {
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
      alert('Please select a valid PDF file.');
      return;
    }

    el.dropZone.classList.add('hidden');
    el.uploadStatus.classList.remove('hidden');
    el.uploadStatusText.textContent = `Processing "${file.name}" into temporary index...`;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (data.status === 'success') {
        state.sessionId = data.session_id || generateUUID();
        state.indexName = data.index_name;
        state.fileName = data.file_name;
        state.isSample = false;

        showChatView();
      } else {
        alert('Upload and indexing failed: ' + (data.message || 'Unknown error'));
        el.dropZone.classList.remove('hidden');
        el.uploadStatus.classList.add('hidden');
      }
    } catch (err) {
      alert('Network error while processing PDF: ' + err.message);
      el.dropZone.classList.remove('hidden');
      el.uploadStatus.classList.add('hidden');
    }
  }

  // --- CHAT & SSE STREAMING ---
  async function submitChat() {
    const text = el.chatInput.value.trim();
    if (!text || state.isStreaming) return;

    state.isStreaming = true;
    el.chatInput.value = '';
    el.chatInput.style.height = 'auto';
    el.btnSend.disabled = true;

    // Append User Message
    appendMessage('user', text);

    // Prepare Assistant Message Container
    const { bubbleEl, metaEl } = createAssistantMessagePlaceholder();
    scrollToBottom();

    const startTime = performance.now();
    let accumulatedText = '';
    let firstTokenTime = null;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          session_id: state.sessionId,
          index_name: state.indexName
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // keep partial

        for (const block of lines) {
          const trimmed = block.trim();
          if (!trimmed.startsWith('data:')) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') {
            break;
          }

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.chunk || parsed.text) {
              const chunk = parsed.chunk || parsed.text;
              if (firstTokenTime === null) {
                firstTokenTime = Math.round(performance.now() - startTime);
              }
              accumulatedText += chunk;
              bubbleEl.innerHTML = renderMarkdown(accumulatedText) + '<span class="typing-cursor"></span>';
              scrollToBottom();
            } else if (parsed.error) {
              accumulatedText += `\n\n*Error: ${parsed.error}*`;
              bubbleEl.innerHTML = renderMarkdown(accumulatedText);
            }
          } catch (e) {
            // ignore unparseable chunk
          }
        }
      }

      // Finished stream
      bubbleEl.innerHTML = renderMarkdown(accumulatedText);
      const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
      const ttftStr = firstTokenTime ? `${firstTokenTime}ms ttft · ` : '';
      metaEl.textContent = `BGE Reranked · ${ttftStr}${totalTime}s`;
    } catch (err) {
      bubbleEl.innerHTML = `<p style="color: var(--status-red)">Error retrieving response: ${err.message}</p>`;
      metaEl.textContent = 'Request failed';
    } finally {
      state.isStreaming = false;
      el.btnSend.disabled = el.chatInput.value.trim().length === 0;
      el.chatInput.focus();
      scrollToBottom();
    }
  }

  function appendMessage(role, text) {
    const row = document.createElement('div');
    row.className = `message-row ${role}`;

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = role === 'user' ? 'You' : 'DocRAG Agent';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = text;

    row.appendChild(meta);
    row.appendChild(bubble);
    el.messagesContainer.appendChild(row);
  }

  function createAssistantMessagePlaceholder() {
    const row = document.createElement('div');
    row.className = 'message-row assistant';

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = 'DocRAG Agent · Retrieving context...';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = '<span class="typing-cursor"></span>';

    row.appendChild(meta);
    row.appendChild(bubble);
    el.messagesContainer.appendChild(row);

    return { bubbleEl: bubble, metaEl: meta };
  }

  function clearMessages() {
    // Clear message feed except welcome banner
    el.messagesContainer.innerHTML = `
      <div class="chat-welcome-banner">
        <div class="welcome-tag">Ready for queries</div>
        <div class="welcome-text">
          Conversation cleared for <strong id="welcome-doc-name">${state.fileName}</strong>.
        </div>
      </div>
    `;
    el.chatInput.value = '';
    el.chatInput.focus();
  }

  async function endCurrentSession() {
    // If user uploaded a custom file, delete the temporary Pinecone index and temp files
    if (state.indexName && !state.isSample) {
      try {
        await fetch('/api/session/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: state.sessionId,
            index_name: state.indexName
          })
        });
      } catch (e) {
        console.warn('Session cleanup error:', e);
      }
    }

    state.sessionId = null;
    state.indexName = null;
    state.fileName = null;
    state.isSample = false;
    showLandingView();
  }

  // --- AUTOMATIC CLEANUP ON CLOSING / LEAVING WEBSITE ---
  window.addEventListener('beforeunload', () => {
    if (state.indexName && !state.isSample) {
      const payload = JSON.stringify({
        session_id: state.sessionId,
        index_name: state.indexName
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/session/cleanup', payload);
      } else {
        fetch('/api/session/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        });
      }
    }
  });

  // --- EVENT LISTENERS ---

  // Landing page sample activation
  el.btnStartSample.addEventListener('click', () => activateSamplePdf());
  el.btnPreviewSample.addEventListener('click', () => {
    state.isSample = true;
    openPdfViewer();
  });

  // Suggested questions from landing page
  el.sampleQueries.forEach(item => {
    item.addEventListener('click', () => {
      const query = item.getAttribute('data-query');
      activateSamplePdf(query);
    });
  });

  // Suggested questions from sidebar
  el.quickPromptBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const query = btn.getAttribute('data-query');
      el.chatInput.value = query;
      submitChat();
    });
  });

  // Drag and drop upload
  el.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.dropZone.classList.add('dragover');
  });

  el.dropZone.addEventListener('dragleave', () => {
    el.dropZone.classList.remove('dragover');
  });

  el.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    el.dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  el.fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  });

  // PDF modal controls
  el.btnViewPdf.addEventListener('click', openPdfViewer);
  el.sidebarBtnView.addEventListener('click', openPdfViewer);
  el.modalBtnClose.addEventListener('click', closePdfViewer);
  el.pdfModal.addEventListener('click', (e) => {
    if (e.target === el.pdfModal) closePdfViewer();
  });

  // End session
  el.btnSwitchDoc.addEventListener('click', endCurrentSession);

  // Clear chat
  el.btnNewChat.addEventListener('click', clearMessages);

  // Chat input handling
  el.chatInput.addEventListener('input', () => {
    el.chatInput.style.height = 'auto';
    el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 140) + 'px';
    el.btnSend.disabled = el.chatInput.value.trim().length === 0;
  });

  el.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitChat();
    }
  });

  el.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitChat();
  });

  // Escape key closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.pdfModal.classList.contains('hidden')) {
      closePdfViewer();
    }
  });

  // Initialize
  showLandingView();
})();
