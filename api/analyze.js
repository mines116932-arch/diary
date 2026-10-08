module.exports = async function handler(req, res) {
  // 1. CORS 설정 (프론트엔드와 원활한 통신을 위함)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS 사전 요청 처리
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST 메서드만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { text } = req.body || {};
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: '일기 내용을 입력해주세요.' });
    }

    // 2. 환경 변수에서 안전하게 API 키 로드 (서버 사이드에서만 실행되므로 프론트엔드 노출 안됨)
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
      return res.status(401).json({ 
        error: '서버 환경 변수(GEMINI_API_KEY)가 설정되지 않았습니다. Vercel 대시보드에서 환경 변수를 추가해주세요.' 
      });
    }

    // 3. 심리 상담사 프롬프트 세팅
    const systemPrompt = `너는 심리 상담사야. 사용자가 작성한 일기 내용을 읽고, 사용자의 감정을 한 단어(예: 기쁨, 슬픔, 분노, 불안, 평온)로 요약해줘. 그리고 그 감정에 공감해주고, 따뜻한 응원의 메시지를 2~3문장으로 작성해줘. 답변 형식은 반드시 '감정: [요약된 감정]\\n\\n[응원메시지]'와 줄바꿈을 포함해서 보내줘.`;

    const requestBody = {
      contents: [
        {
          parts: [
            { text: systemPrompt },
            { text: `[사용자 일기 내용]\n${text.trim()}` }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: "text/plain"
      }
    };

    // 4. Gemini 모델 폴백 전략 (최신 → 안정 순으로 순차 시도)
    const models = [
      'gemini-3.8-flash',
      'gemini-3.5-flash',
      'gemini-3.1-flash',
      'gemini-2.5-flash',
    ];
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

        // ==========================================
        // 5. Redis 데이터베이스에 저장 로직 추가
        // ==========================================
        try {
          const redisUrl = process.env.REDIS_URL;
          if (redisUrl) {
            const Redis = require('ioredis');
            const redis = new Redis(redisUrl);
            
            // 현재 시간을 기준으로 고유한 키(Key) 생성 (예: diary-2022060126123000)
            const now = new Date();
            const timestamp = now.getFullYear().toString() +
                              String(now.getMonth() + 1).padStart(2, '0') +
                              String(now.getDate()).padStart(2, '0') +
                              String(now.getHours()).padStart(2, '0') +
                              String(now.getMinutes()).padStart(2, '0') +
                              String(now.getSeconds()).padStart(2, '0');
            // 밀리초를 더해서 완벽한 고유성 보장 방식을 취할 수도 있지만 사용자 요청 예시를 따름
            const key = `diary-${timestamp}`;
            
            const payload = JSON.stringify({
              originalContent: text.trim(),
              aiResponse: rawText.trim(),
              createdAt: now.toISOString()
            });
            
            await redis.set(key, payload);
            console.log(`[Redis] 성공적으로 저장되었습니다. Key: ${key}`);
            
            // 서버리스 환경에서는 연결을 닫아주는 것이 좋습니다.
            redis.quit();
          } else {
            console.warn('[Redis] REDIS_URL 환경변수가 설정되지 않아 저장을 건너뜁니다.');
          }
        } catch (redisError) {
          console.error('[Redis Error] 데이터 저장 중 오류 발생:', redisError);
          // Redis 에러가 나더라도 사용자에게는 AI 답변을 정상적으로 보여주기 위해 에러를 던지지 않음
        }

        // 6. 프론트엔드로 성공 결과 및 텍스트 응답 전달
        return res.status(200).json({
          success: true,
          data: {
            type: 'text',
            content: rawText.trim()
          }
        });

      } catch (err) {
        lastError = err;
        console.warn(`[Gemini API] ${model} 호출 실패, 대안 시도 중...:`, err.message);
      }
    }

    // 모델 호출이 모두 실패했을 경우 에러 던지기
    throw lastError;

  } catch (error) {
    console.error('Vercel API Error:', error);
    return res.status(500).json({ 
      error: 'Gemini API 호출 중 오류가 발생했습니다: ' + error.message 
    });
  }
}
