/**
 * GeminiAdapter.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Wraps Google Gemini 1.5 Flash for multi-document receipt/invoice extraction.
 * Returns structured data with per-field confidence scores matching the v1.0.0 baseline.
 *
 * Evidence baseline from screenshots:
 *   - doc_type: RECEIPT / INVOICE / DOCUMENT
 *   - confidence_vendor, confidence_date, confidence_total, confidence_category
 *   - line_items with name, qty, unit_price
 *   - payment_method: Credit / Debit / Cash
 *   - category: Food / Transport / Notice / etc.
 */

export interface ExtractionResult {
  doc_type: 'RECEIPT' | 'INVOICE' | 'DOCUMENT' | 'STATEMENT';
  vendor: string | null;
  date: string | null;          // ISO 8601 YYYY-MM-DD
  total: number | null;
  subtotal: number | null;
  tax: number | null;
  tax_gst: number | null;
  tax_hst: number | null;
  tax_pst: number | null;
  payment_method: string | null;
  category: string | null;
  description: string | null;
  issuer: string | null;
  line_items: LineItem[];
  raw_fields: Record<string, unknown>;
  confidence_vendor: number;    // 0.00–1.00
  confidence_date: number;
  confidence_total: number;
  confidence_category: number;
  gemini_model: string;
}

export interface LineItem {
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

const EXTRACTION_PROMPT = `
You are a financial document extraction AI. Analyze the provided document image and extract all financial information.

Return ONLY valid JSON matching this exact schema:
{
  "doc_type": "RECEIPT" | "INVOICE" | "DOCUMENT" | "STATEMENT",
  "vendor": string | null,
  "date": "YYYY-MM-DD" | null,
  "total": number | null,
  "subtotal": number | null,
  "tax": number | null,
  "tax_gst": number | null,
  "tax_hst": number | null,
  "tax_pst": number | null,
  "payment_method": "Credit" | "Debit" | "Cash" | "Cheque" | "Transfer" | null,
  "category": string | null,
  "description": string | null,
  "issuer": string | null,
  "line_items": [
    { "name": string, "quantity": number, "unit_price": number, "total": number }
  ],
  "confidence_vendor": 0.00-1.00,
  "confidence_date": 0.00-1.00,
  "confidence_total": 0.00-1.00,
  "confidence_category": 0.00-1.00
}

Doc type rules:
- RECEIPT: point-of-sale purchase, grocery, restaurant, retail
- INVOICE: business-to-business, professional services, automotive
- STATEMENT: bank statement, account balance, financial summary
- DOCUMENT: any other financial document (notice, letter, form)

Category rules (use these): Food, Transport, Automotive, Office, Travel, Entertainment, 
Professional, Utilities, Insurance, Medical, Notice, Other

Confidence rules:
- 0.95-1.00: clearly legible, unambiguous
- 0.80-0.94: legible with minor uncertainty
- 0.60-0.79: partially legible or inferred
- 0.00-0.59: not found or very unclear

For Canadian documents:
- GST is 5% federal tax
- HST is combined federal+provincial (13-15%)
- PST is provincial tax (6-10%)
- Extract whichever tax types are present

Return ONLY the JSON object. No markdown. No explanation.
`;

export class GeminiAdapter {
  private apiKey: string;
  private model: string = 'gemini-1.5-flash';
  private apiBase = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required');
    this.apiKey = apiKey;
  }

  async extractDocument(imageBase64: string, mimeType: string = 'image/jpeg'): Promise<ExtractionResult> {
    const url = `${this.apiBase}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [{
        parts: [
          { text: EXTRACTION_PROMPT },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${err}`);
    }

    const data = await response.json() as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('Gemini returned empty response');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Attempt to extract JSON from response if wrapped in markdown
      const match = text.match(/\{[\s\S]+\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error(`Gemini response is not valid JSON: ${text.slice(0, 200)}`);
      }
    }

    return this.validate(parsed);
  }

  private validate(raw: any): ExtractionResult {
    const validTypes = ['RECEIPT', 'INVOICE', 'DOCUMENT', 'STATEMENT'];
    const doc_type = validTypes.includes(raw.doc_type) ? raw.doc_type : 'DOCUMENT';

    return {
      doc_type,
      vendor: raw.vendor ?? null,
      date: this.validateDate(raw.date),
      total: typeof raw.total === 'number' ? raw.total : null,
      subtotal: typeof raw.subtotal === 'number' ? raw.subtotal : null,
      tax: typeof raw.tax === 'number' ? raw.tax : null,
      tax_gst: typeof raw.tax_gst === 'number' ? raw.tax_gst : null,
      tax_hst: typeof raw.tax_hst === 'number' ? raw.tax_hst : null,
      tax_pst: typeof raw.tax_pst === 'number' ? raw.tax_pst : null,
      payment_method: raw.payment_method ?? null,
      category: raw.category ?? null,
      description: raw.description ?? null,
      issuer: raw.issuer ?? null,
      line_items: Array.isArray(raw.line_items) ? raw.line_items : [],
      raw_fields: raw,
      confidence_vendor: this.clampConfidence(raw.confidence_vendor),
      confidence_date: this.clampConfidence(raw.confidence_date),
      confidence_total: this.clampConfidence(raw.confidence_total),
      confidence_category: this.clampConfidence(raw.confidence_category),
      gemini_model: this.model
    };
  }

  private validateDate(d: any): string | null {
    if (!d || typeof d !== 'string') return null;
    const match = d.match(/^\d{4}-\d{2}-\d{2}$/);
    return match ? d : null;
  }

  private clampConfidence(v: any): number {
    const n = typeof v === 'number' ? v : 0;
    return Math.max(0, Math.min(1, n));
  }
}
