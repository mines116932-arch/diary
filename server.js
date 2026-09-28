// server.js - AI 감정 일기 로컬 웹 및 Gemini API 연동 서버
const http = require('http');
const fs = require('fs');
const path = require('path');

// 1. 환경 변수 불러오기
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;

// 지원할 MIME 타입 목록
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// 정적 파일 서빙 헬퍼 함수
function serveStaticFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// Google Gemini API 호출 함수
async function callGeminiApi(diaryText) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('KEY_NOT_CONFIGURED');
  }

  // 사용자가 요청한 심리 상담사 프롬프트
  const systemPrompt = `너는 심리 상담사야. 사용자가 작성한 일기 내용을 읽고, 사용자의 감정을 한 단어(예: 기쁨, 슬픔, 분노, 불안, 평온)로 요약해줘. 그리고 그 감정에 공감해주고, 따뜻한 응원의 메시지를 2~3문장으로 작성해줘. 답변 형식은 반드시 '감정: [요약된 감정]\\n\\n[응원메시지]'와 줄바꿈을 포함해서 보내줘.`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: systemPrompt },
          { text: `[사용자 일기 내용]\n${diaryText}` }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "text/plain"
    }
  };

  // 최신 flash 모델 사용
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API 요청 실패 (HTTP ${response.status})`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!rawText) {
        throw new Error('Gemini로부터 응답 텍스트를 받지 못했습니다.');
      }

      // 프롬프트가 요청한 텍스트 그대로 반환
      return { type: 'text', content: rawText.trim() };
    } catch (err) {
      lastError = err;
      console.warn(`[Gemini API] ${model} 호출 실패, 대안 시도 중...:`, err.message);
    }
  }

  throw lastError;
}

// HTTP 서버 생성
const server = http.createServer(async (req, res) => {
  // CORS 및 JSON 헤더 설정
  const setCorsHeaders = () => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  };

  setCorsHeaders();

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Gemini API 분석 요청 엔드포인트: POST /api/analyze
  if (req.url === '/api/analyze' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { text } = JSON.parse(body || '{}');

        if (!text || text.trim().length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '일기 내용을 입력해주세요.' }));
          return;
        }

        // Gemini API 호출
        const result = await callGeminiApi(text.trim());

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, data: result }));
      } catch (error) {
        console.error('분석 처리 중 에러 발생:', error);

        if (error.message === 'KEY_NOT_CONFIGURED') {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            error: 'GEMINI_API_KEY가 아직 설정되지 않았습니다. .env 파일에 발급받으신 API 키를 입력해 주세요.'
          }));
          return;
        }

        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          error: 'Gemini API 호출 중 오류가 발생했습니다: ' + error.message
        }));
      }
    });
    return;
  }

  // 2. 정적 웹 파일 서빙 (GET 요청)
  if (req.method === 'GET') {
    let reqPath = req.url === '/' ? '/index.html' : req.url;
    reqPath = reqPath.split('?')[0]; // 쿼리스트링 제거

    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, safePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    serveStaticFile(res, filePath, contentType);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
});

// 서버 실행
server.listen(PORT, () => {
  console.log('====================================================');
  console.log(`✨ AI 감정 일기 서버가 성공적으로 시작되었습니다!`);
  console.log(`🌐 접속 주소: http://localhost:${PORT}`);
  console.log(`🔑 GEMINI_API_KEY 상태: ${GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE' ? '설정 완료' : '⚠️ 미설정 (.env 파일 확인 필요)'}`);
  console.log('====================================================');
});
