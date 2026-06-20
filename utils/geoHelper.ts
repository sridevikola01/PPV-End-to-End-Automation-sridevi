import * as https from 'https';

function getJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 3000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Status ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

export async function getGeolocationRegion(): Promise<string> {
  if (process.env.DAZN_REGION) {
    console.log(`🌍 Using DAZN_REGION from environment: ${process.env.DAZN_REGION}`);
    return process.env.DAZN_REGION.toUpperCase();
  }

  console.log('🌍 DAZN_REGION not set. Detecting region dynamically via geolocation APIs...');
  
  const apis = [
    { url: 'https://ipapi.co/json', key: 'country_code' },
    { url: 'https://ipinfo.io/json', key: 'country' }
  ];

  for (const api of apis) {
    try {
      const data = await getJson(api.url);
      const country = data[api.key];
      if (country && typeof country === 'string' && country.length === 2) {
        const region = country.toUpperCase();
        console.log(`🌍 Geolocation check succeeded via ${api.url}: detected country is "${region}"`);
        return region;
      }
    } catch (e: any) {
      console.warn(`⚠️ Geolocation check failed via ${api.url}: ${e.message}`);
    }
  }

  console.warn('⚠️ All geolocation APIs failed. Falling back to default region "GB"');
  return 'GB';
}
