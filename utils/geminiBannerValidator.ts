import fs from 'fs';
import https from 'https';
import path from 'path';

type BannerAssessment = {
  pass: boolean;
  imageQuality: 'pass' | 'fail' | 'uncertain';
  playersVisible: 'pass' | 'fail' | 'uncertain';
  playersCutOff: 'pass' | 'fail' | 'uncertain';
  findings: string[];
};

function requestGemini(url: string, apiKey: string, body: Buffer): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => resolve({
        statusCode: response.statusCode || 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(30_000, () => request.destroy(new Error('Gemini request timed out after 30 seconds')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function parseAssessment(responseBody: string): BannerAssessment {
  const response = JSON.parse(responseBody) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = response.candidates?.[0]?.content?.parts?.find(part => part.text)?.text;
  if (!text) throw new Error('Gemini returned no text assessment');

  const assessment = JSON.parse(text) as BannerAssessment;
  if (typeof assessment.pass !== 'boolean' || !Array.isArray(assessment.findings)) {
    throw new Error('Gemini returned an invalid banner assessment');
  }
  return assessment;
}

/**
 * Checks only the rendered PPV banner image in GitHub Actions. Gemini findings
 * are initially warn-only so visual-model uncertainty cannot block PPV flows.
 */
export async function validatePpvBannerImage(
  banner: { screenshot(options: { path: string; type: 'png' }): Promise<Buffer> },
  context: { region: string; flow: string }
): Promise<void> {
  if (process.env.GITHUB_ACTIONS !== 'true') return;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('ℹ️ [Gemini Banner] GEMINI_API_KEY is not configured; visual check skipped.');
    return;
  }

  try {
    const evidenceDir = path.resolve(process.cwd(), 'test-results', 'gemini-banner');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const imagePath = path.join(evidenceDir, `ppv-banner-${context.region}-${timestamp}.png`);
    await banner.screenshot({ path: imagePath, type: 'png' });

    const image = fs.readFileSync(imagePath).toString('base64');
    const schema = {
      type: 'object',
      properties: {
        pass: { type: 'boolean', description: 'True only when every requested visual check passes.' },
        imageQuality: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
        playersVisible: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
        playersCutOff: { type: 'string', enum: ['pass', 'fail', 'uncertain'] },
        findings: { type: 'array', items: { type: 'string' } },
      },
      required: ['pass', 'imageQuality', 'playersVisible', 'playersCutOff', 'findings'],
    };
    const prompt = [
      'You are a strict visual QA reviewer for a DAZN pay-per-view banner.',
      'Assess only what is visibly present in this screenshot; do not infer missing details.',
      'Check: (1) the banner image is not materially blurry, pixelated, broken, or obscured;',
      '(2) the featured fighter/player subjects are visibly recognisable when people are present;',
      '(3) no featured subject has a materially unintended crop such as a face or main body being cut off at a banner edge.',
      'Normal intentional design cropping is acceptable. If the banner contains no person, set playersVisible and playersCutOff to "uncertain" and do not fail solely for that reason.',
      'Return concise findings suitable for developers.',
    ].join(' ');
    const payload = Buffer.from(JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: 'image/png', data: image } },
        { text: prompt },
      ] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0,
      },
    }));
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const response = await requestGemini(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      apiKey,
      payload
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Gemini returned HTTP ${response.statusCode}: ${response.body.slice(0, 500)}`);
    }

    const assessment = parseAssessment(response.body);
    fs.writeFileSync(`${imagePath}.json`, `${JSON.stringify(assessment, null, 2)}\n`);
    const icon = assessment.pass ? '✅' : '⚠️';
    console.log(`${icon} [Gemini Banner] ${assessment.pass ? 'PASS' : 'WARNING'} | quality=${assessment.imageQuality} | players=${assessment.playersVisible} | crop=${assessment.playersCutOff}`);
    for (const finding of assessment.findings) console.log(`   [Gemini Banner] ${finding}`);
  } catch (error: any) {
    // Gemini is supplementary QA; an API/quota/model issue must not hide the E2E result.
    console.warn(`⚠️ [Gemini Banner] Visual check could not run: ${error?.message || error}`);
  }
}
