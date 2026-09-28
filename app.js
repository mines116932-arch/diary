// DOM 요소 참조
const diaryInput = document.getElementById('diary-input');
const charCount = document.getElementById('char-count');
const voiceBtn = document.getElementById('voice-btn');
const analyzeBtn = document.getElementById('analyze-btn');
const aiResponseBox = document.getElementById('ai-response-box');

// 1. 글자 수 실시간 카운트
diaryInput.addEventListener('input', () => {
  const length = diaryInput.value.length;
  charCount.textContent = `${length}자`;
});

// 2. 음성 인식 기능 (Web Speech API)
let recognition = null;
let isRecording = false;
let baseTextBeforeRecording = '';

// 브라우저 Web Speech API 지원 여부 확인
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'ko-KR'; // 한국어 음성 인식
  recognition.continuous = false; // 한 번의 발화 세션 후 자연스럽게 완료
  recognition.interimResults = true; // 실시간 변환 텍스트 반영

  recognition.onstart = () => {
    isRecording = true;
    baseTextBeforeRecording = diaryInput.value.trim();
    voiceBtn.classList.add('recording');
    voiceBtn.innerHTML = `
      <span class="btn-icon">🎙️</span>
      <span class="btn-text">음성 인식 중...</span>
    `;
  };

  // 음성을 텍스트로 변환하여 넓은 입력창에 자동 채움
  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }

    if (transcript) {
      const separator = baseTextBeforeRecording ? ' ' : '';
      diaryInput.value = baseTextBeforeRecording + separator + transcript.trim();
      charCount.textContent = `${diaryInput.value.length}자`;
      diaryInput.scrollTop = diaryInput.scrollHeight;
    }
  };

  recognition.onerror = (event) => {
    console.error('음성 인식 오류:', event.error);
    stopRecording();
    if (event.error === 'not-allowed') {
      alert('마이크 사용 권한이 차단되어 있습니다. 브라우저 주소창의 자물쇠/설정 아이콘을 클릭하여 마이크 권한을 허용해주세요.');
    } else if (event.error !== 'no-speech') {
      alert('음성 인식 중 오류가 발생했습니다: ' + event.error);
    }
  };

  // 인식이 끝나면 다시 '음성으로 입력하기'로 복원
  recognition.onend = () => {
    stopRecording();
  };
}

function stopRecording() {
  isRecording = false;
  voiceBtn.classList.remove('recording');
  voiceBtn.innerHTML = `
    <span class="btn-icon">🎙️</span>
    <span class="btn-text">음성으로 입력하기</span>
  `;
}

// '음성으로 입력하기' 버튼 클릭 이벤트
voiceBtn.addEventListener('click', () => {
  if (!recognition) {
    alert('현재 브라우저에서는 Web Speech API를 지원하지 않습니다.\nGoogle Chrome 또는 Microsoft Edge 브라우저를 이용해주세요.');
    return;
  }

  if (!isRecording) {
    try {
      recognition.start();
    } catch (e) {
      console.error('음성 인식 시작 실패:', e);
    }
  } else {
    recognition.stop();
  }
});

// 3. 감정 분석 요청 기능 (Google Gemini API 연동)
analyzeBtn.addEventListener('click', handleAnalyze);

// Ctrl + Enter로도 분석 요청 가능
diaryInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    handleAnalyze();
  }
});

async function handleAnalyze() {
  const content = diaryInput.value.trim();

  if (!content) {
    alert('오늘의 하루 이야기를 먼저 작성해주세요!');
    diaryInput.focus();
    return;
  }

  if (content.length < 5) {
    alert('조금 더 자세한 감정이나 이야기를 적어주시면 더 풍부한 답변을 드릴 수 있어요!');
    diaryInput.focus();
    return;
  }

  // 로딩 상태 표시
  analyzeBtn.disabled = true;
  aiResponseBox.classList.remove('has-response');
  aiResponseBox.innerHTML = `
    <div class="loading-indicator">
      <div class="spinner"></div>
      <p>Google Gemini AI가 일기를 읽고 마음과 감정을 분석하고 있습니다... 💭</p>
    </div>
  `;

  // 백엔드(Vercel 서버리스 함수)로 일기 내용 전송
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: content })
    });

    const result = await response.json();

    if (response.ok && result.success) {
      // API 응답을 화면에 표시
      renderResponse(result.data);
    } else {
      showErrorMessage(result.error || '분석 요청 중 문제가 발생했습니다.');
    }
  } catch (error) {
    console.error('API 호출 에러:', error);
    showErrorMessage('서버와 통신할 수 없습니다: ' + error.message);
  } finally {
    // 분석 완료 후 버튼 다시 활성화
    analyzeBtn.disabled = false;
  }
}

function showErrorMessage(msg) {
  aiResponseBox.classList.remove('has-response');
  aiResponseBox.innerHTML = `
    <div style="color: #b91c1c; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px; line-height: 1.6; white-space: pre-line;">
      ${msg}
    </div>
  `;
}

// 오프라인 시뮬레이션(generateEmotionAnalysis) 로직은 Vercel API 이관으로 삭제되었습니다.

// 4. AI 답변을 회색 박스에 렌더링
function renderResponse(analysis) {
  aiResponseBox.classList.add('has-response');
  
  // Gemini API가 일반 텍스트로 응답한 경우 (사용자 요청 포맷)
  if (analysis.type === 'text' && analysis.content) {
    aiResponseBox.innerHTML = `
      <div class="response-body" style="font-size: 1.05rem; line-height: 1.8;">
        ${analysis.content.replace(/\n/g, '<br>')}
      </div>
    `;
    saveToLocalStorage();
    return;
  }

  // 오프라인 시뮬레이션 폴백의 경우
  const emotionTitle = analysis.emotion || analysis.primary || '감정 분석';
  const icon = analysis.icon || '✨';
  const bodyText = analysis.message || (analysis.messages ? analysis.messages.join(' ') : '');
  const cheerText = analysis.cheer || '';

  aiResponseBox.innerHTML = `
    <div class="response-header-badge">
      <span>${icon} 감정 분석:</span>
      <span class="response-emotion-tag">${emotionTitle}</span>
    </div>
    <div class="response-body">
      <p style="margin-bottom: 10px; font-size: 1.02rem; line-height: 1.8;">${bodyText}</p>
      ${cheerText ? `<p style="font-weight: 500; color: #4338ca;">${cheerText}</p>` : ''}
    </div>
  `;
  
  saveToLocalStorage();
}

// 5. 로컬 스토리지 저장 및 불러오기 기능
function saveToLocalStorage() {
  localStorage.setItem('ai_diary_content', diaryInput.value);
  localStorage.setItem('ai_diary_response_html', aiResponseBox.innerHTML);
}

window.addEventListener('DOMContentLoaded', () => {
  const savedContent = localStorage.getItem('ai_diary_content');
  const savedResponseHtml = localStorage.getItem('ai_diary_response_html');

  if (savedContent) {
    diaryInput.value = savedContent;
    charCount.textContent = `${savedContent.length}자`;
  }

  if (savedResponseHtml) {
    aiResponseBox.innerHTML = savedResponseHtml;
    aiResponseBox.classList.add('has-response');
  }
});
