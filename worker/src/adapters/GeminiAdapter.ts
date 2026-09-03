/**
 * GeminiAdapter.ts
 * FME Mission 001 - Snap It & Forget It
 *
 * Wraps Google Gemini Flash for multi-document receipt/invoice extraction.
 * Returns structured data with per-field confidence scores matching the v1.0.0 baseline.
 *
 * Evidence baseline from screenshots:
 *   - doc_type: RECEIPT / INVOICE / DOCUMENT
 *   - confidence_vendor, confidence_date, confidence_total, confidence_category
 *   - line_items with name, qty, unit_price
 *   - payment_method: Credit / Debit / Cash
 *   - category: Food / Transport / Notice / etc.
 *
 * Model history:
 *   gemini-1.5-flash   → shut down (all 1.x)
 *   gemini-2.0-flash   → shut down June 1, 2026
 *   gemini-3.5-flash   → CURRENT production model (as of Sept 2026)
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
  confidence_vendor: number;    // 0.00-1.00
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

const MULTI_DOC_PROMPT = `
You are a financial document extraction AI. Analyze the provided image carefully.

IMPORTANT: The image may contain MULTIPLE separate physical documents (receipts, invoices, statements, bills) laid out together. Your task is to:
1. DETECT every distinct, separate document visible in the image
2. EXTRACT financial information from EACH detected document independently
3. Return an ARRAY of JSON objects - one object per detected document

If only ONE document is visible, return an array with a single object.
If NO financial documents are visible, return an empty array [].

For EACH detected document, extract:
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
- INVOICE: business-to-business, professional services
- STATEMENT: bank statement, account summary
- DOCUMENT: any other financial document

Category rules: Food, Transport, Automotive, Office, Travel, Entertainment, Professional, Utilities, Insurance, Medical, Notice, Other

Return ONLY a JSON array. No markdown. No explanation.
`;

const SINGLE_DOC_PROMPT = `
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
  // gemini-3.5-flash: current production Flash model as of Sept 2026
  // gemini-2.0-flash was shut down June 1, 2026
  private model: string = 'gemini-3.5-flash';
  private apiBase = 'https://generativelanguage.googleapis.com/v1beta';
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required');
    this.apiKey = apiKey;
  }

  async extractDocuments(imageBase64: string, mimeType: string = 'image/jpeg', attempt: number = 0): Promise<ExtractionResult[]> {
    // Variant B (prompt-only, no responseSchema) — A/B test showed this is more reliable
    const url = `${this.apiBase}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [{
        parts: [
          { text: MULTI_DOC_PROMPT },
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
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
        // NOTE: No responseSchema — prompt-only JSON generation (Variant B, proven reliable)
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
    const candidate = data?.candidates?.[0];

    if (!candidate) {
      throw new Error('Gemini returned empty response (no candidates)');
    }

    const finishReason = candidate.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      if (attempt < 1) {
        console.warn(`[Gemini] finishReason=${finishReason}, retrying multi-doc detection (no schema)...`);
        return this.extractDocuments(imageBase64, mimeType, attempt + 1);
      }
      throw new Error(`Gemini response incomplete: finishReason=${finishReason}`);
    }

    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini returned empty response (no text)');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (e: any) {
      const match = text.match(/\[[\s\S]+\]/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          throw new Error(`Gemini response is not valid JSON array: ${e.message}. Text: ${text.slice(0, 200)}`);
        }
      } else {
        throw new Error(`Gemini response is not valid JSON array: ${e.message}. Text: ${text.slice(0, 200)}`);
      }
    }

    if (!Array.isArray(parsed)) {
      // If Gemini returned a single object instead of array, wrap it
      if (parsed && typeof parsed === 'object') {
        parsed = [parsed];
      } else {
        throw new Error('Gemini response is not a JSON array or object');
      }
    }

    return parsed.map((item: any) => this.validate(item));
  }

  async extractDocumentsNoSchema(imageBase64: string, mimeType: string = 'image/jpeg', attempt: number = 0): Promise<ExtractionResult[]> {
    const url = `${this.apiBase}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [{
        parts: [
          { text: MULTI_DOC_PROMPT },
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
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
        // NOTE: No responseSchema — prompt-only JSON generation
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
    const candidate = data?.candidates?.[0];

    if (!candidate) {
      throw new Error('Gemini returned empty response (no candidates)');
    }

    const finishReason = candidate.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      if (attempt < 1) {
        console.warn(`[Gemini] finishReason=${finishReason}, retrying multi-doc detection (no schema)...`);
        return this.extractDocumentsNoSchema(imageBase64, mimeType, attempt + 1);
      }
      throw new Error(`Gemini response incomplete: finishReason=${finishReason}`);
    }

    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini returned empty response (no text)');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (e: any) {
      const match = text.match(/\[[\s\S]+\]/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          throw new Error(`Gemini response is not valid JSON array: ${e.message}. Text: ${text.slice(0, 200)}`);
        }
      } else {
        throw new Error(`Gemini response is not valid JSON array: ${e.message}. Text: ${text.slice(0, 200)}`);
      }
    }

    if (!Array.isArray(parsed)) {
      if (parsed && typeof parsed === 'object') {
        parsed = [parsed];
      } else {
        throw new Error('Gemini response is not a JSON array or object');
      }
    }

    return parsed.map((item: any) => this.validate(item));
  }

  async extractDocument(imageBase64: string, mimeType: string = 'image/jpeg', attempt: number = 0): Promise<ExtractionResult> {
    const url = `${this.apiBase}/models/${this.model}:generateContent?key=${this.apiKey}`;

    // Structured output schema matching ExtractionResult
    const responseSchema = {
      type: 'OBJECT' as const,
      properties: {
        doc_type: { type: 'STRING' as const, enum: ['RECEIPT', 'INVOICE', 'DOCUMENT', 'STATEMENT'] },
        vendor: { type: 'STRING' as const, nullable: true },
        date: { type: 'STRING' as const, nullable: true },
        total: { type: 'NUMBER' as const, nullable: true },
        subtotal: { type: 'NUMBER' as const, nullable: true },
        tax: { type: 'NUMBER' as const, nullable: true },
        tax_gst: { type: 'NUMBER' as const, nullable: true },
        tax_hst: { type: 'NUMBER' as const, nullable: true },
        tax_pst: { type: 'NUMBER' as const, nullable: true },
        payment_method: { type: 'STRING' as const, nullable: true },
        category: { type: 'STRING' as const, nullable: true },
        description: { type: 'STRING' as const, nullable: true },
        issuer: { type: 'STRING' as const, nullable: true },
        line_items: {
          type: 'ARRAY' as const,
          items: {
            type: 'OBJECT' as const,
            properties: {
              name: { type: 'STRING' as const },
              quantity: { type: 'NUMBER' as const },
              unit_price: { type: 'NUMBER' as const },
              total: { type: 'NUMBER' as const }
            },
            required: ['name', 'quantity', 'unit_price', 'total']
          }
        },
        confidence_vendor: { type: 'NUMBER' as const },
        confidence_date: { type: 'NUMBER' as const },
        confidence_total: { type: 'NUMBER' as const },
        confidence_category: { type: 'NUMBER' as const }
      },
      required: ['doc_type', 'confidence_vendor', 'confidence_date', 'confidence_total', 'confidence_category']
    };

    const body = {
      contents: [{
        parts: [
          { text: SINGLE_DOC_PROMPT },
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
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        responseSchema
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
    const candidate = data?.candidates?.[0];

    if (!candidate) {
      throw new Error('Gemini returned empty response (no candidates)');
    }

    // Check finishReason - if not STOP, the response may be truncated
    const finishReason = candidate.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      // Retry once if incomplete
      if (attempt < 1) {
        console.warn(`[Gemini] finishReason=${finishReason}, retrying document...`);
        return this.extractDocument(imageBase64, mimeType, attempt + 1);
      }
      throw new Error(`Gemini response incomplete: finishReason=${finishReason}`);
    }

    const text = candidate?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('Gemini returned empty response (no text)');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (e: any) {
      // Attempt to extract JSON from response if wrapped in markdown
      const match = text.match(/\{[\s\S]+\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          throw new Error(`Gemini response is not valid JSON: ${e.message}. Text: ${text.slice(0, 200)}`);
        }
      } else {
        throw new Error(`Gemini response is not valid JSON: ${e.message}. Text: ${text.slice(0, 200)}`);
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
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }
}
