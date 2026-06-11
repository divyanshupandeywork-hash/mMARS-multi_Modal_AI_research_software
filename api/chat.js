import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
  // Allow only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API Key is not configured on the server. Please verify environment variables in Vercel.' });
  }

  const { parts, history, modelName, temperature, systemInstruction } = req.body;

  if (!parts || !modelName) {
    return res.status(400).json({ error: 'Missing required parameters (parts or modelName)' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      systemInstruction: systemInstruction 
    });

    const formattedHistory = [];
    if (history && Array.isArray(history)) {
      history.forEach(msg => {
        formattedHistory.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        });
      });
    }

    const chatSession = model.startChat({
      history: formattedHistory,
      generationConfig: {
        temperature: parseFloat(temperature) || 0.3,
      }
    });

    const result = await chatSession.sendMessage(parts);
    const answer = result.response.text();

    return res.status(200).json({ answer });
  } catch (err) {
    console.error('Error in Vercel serverless function:', err);
    // Bubble up Google 429 rate limit / quota errors with 429 status code
    const errMsg = err.message || '';
    const isRateLimit = errMsg.includes('429') || 
                        errMsg.toLowerCase().includes('quota') || 
                        errMsg.toLowerCase().includes('rate limit') || 
                        errMsg.toLowerCase().includes('limit exceeded') ||
                        errMsg.toLowerCase().includes('overloaded');
    
    const statusCode = isRateLimit ? 429 : 500;
    return res.status(statusCode).json({ error: errMsg || 'An error occurred during Gemini AI processing.' });
  }
}
