export default async function handler(req, res) {
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

    // 4. 최신 flash 모델 사용 및 에러 대비 폴백(fallback) 로직
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

        // 5. 프론트엔드로 성공 결과 및 텍스트 응답 전달
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
