/**
 * GeminiAdapter.ts
 * FME Mission 001 - Snap It & Forget It
 *
 * DATE FIX (2026-09-06):
 * Root cause proven: Canadian retail receipts print dates DD/MM/YY.
 * Gemini was consistently misinterpreting the group order, assigning
 * the day group as year (e.g. reading 13/08/26 as 2013-08-26 instead
 * of 2026-08-13).
 *
 * Fix 1 — Both prompts now include an explicit NUMERIC DATE RULE that:
 *   - Instructs Gemini to read groups in printed order
 *   - Disambiguates using valid calendar rules
 *   - Prefers recent/plausible interpretations
 *   - Returns null rather than guessing on genuine ambiguity
 *
 * Fix 2 — validate() sets confidence_date = 0 when validateDate()
 *   rejects the raw date. Prevents showing "Date 95%" in Review while
 *   the actual stored date is null.
 *
 * Model history:
 *   gemini-1.5-flash  → shut down
 *   gemini-2.0-flash  → shut down June 1 2026
 *   gemini-3.5-flash  → CURRENT (Sept 2026)
 */

export interface ExtractionResult {
  doc_type: 'RECEIPT' | 'INVOICE' | 'DOCUMENT' | 'STATEMENT';
  vendor: string | null;
  date: string | null;
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
  confidence_vendor: number;
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

function currentYear(): number {
  return new Date().getFullYear();
}

/**
 * Numeric date disambiguation rule — inserted into both prompts.
 * Addresses DD/MM/YY vs MM/DD/YY vs YY/MM/DD group-order confusion
 * on Canadian retail receipts.
 */
const NUMERIC_DATE_RULE = `
NUMERIC DATE RULE:
When a date contains three numeric groups separated by / or - (e.g. 13/08/26, 08/13/26, 26/08/13):
1. Read the groups in the EXACT ORDER they are printed. Do NOT reverse or reorder them.
2. Determine the format using valid calendar rules (DD/MM/YY, MM/DD/YY, or YY/MM/DD).
   - A group cannot be a month if it is > 12.
   - A group cannot be a day if it is > 31.
   - A two-digit year group (e.g. 26) means 20YY: so 26 = 2026, 25 = 2025.
3. Prefer an interpretation that produces a plausible recent business-document date.
   Do not return an implausible historical year (e.g. 2013) merely because groups are ambiguous.
4. If more than one interpretation remains genuinely plausible after step 3, return date = null.

Examples:
  printed "13/08/26" -> DD/MM/YY -> day=13, month=08, year=2026 -> 2026-08-13
  printed "08/13/26" -> MM/DD/YY -> month=08, day=13, year=2026 -> 2026-08-13
  printed "26/08/13" -> YY/MM/DD -> year=2026, month=08, day=13 -> 2026-08-13
  printed "26/08/26" -> ambiguous (could be YY/MM/DD or DD/MM/YY) -> null

NEVER silently reorder printed groups before interpreting them.
`;

function buildMultiDocPrompt(): string {
  return `
You are a financial document extraction AI. Analyze the provided image carefully.

This image may contain MULTIPLE separate physical documents (receipts, invoices, statements, bills).
Detect every distinct document. Return one JSON object per document as an array.
If only one document is visible, return an array with one object.
If no financial documents are visible, return [].

For EACH detected document extract:
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
  "line_items": [ { "name": string, "quantity": number, "unit_price": number, "total": number } ],
  "confidence_vendor": 0.00-1.00,
  "confidence_date": 0.00-1.00,
  "confidence_total": 0.00-1.00,
  "confidence_category": 0.00-1.00
}

DATE RULES:
- Always return date as YYYY-MM-DD.
- If the full 4-digit year is clearly printed, use it exactly.
- If only MM/DD is visible with no year, default the year to ${currentYear()}.
- If no date is visible, return null.
${NUMERIC_DATE_RULE}

Doc type rules:
- RECEIPT: point-of-sale purchase, grocery, restaurant, retail
- INVOICE: business-to-business, professional services
- STATEMENT: bank statement, account summary
- DOCUMENT: any other financial document

Category rules: Food, Transport, Automotive, Office, Travel, Entertainment, Professional, Utilities, Insurance, Medical, Notice, Other

Return ONLY a JSON array. No markdown. No explanation.
`;
}

function buildSingleDocPrompt(): string {
  return `
You are a financial document extraction AI. Analyze this document image and extract all financial information.

Return ONLY valid JSON:
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
  "line_items": [ { "name": string, "quantity": number, "unit_price": number, "total": number } ],
  "confidence_vendor": 0.00-1.00,
  "confidence_date": 0.00-1.00,
  "confidence_total": 0.00-1.00,
  "confidence_category": 0.00-1.00
}

DATE RULES:
- Always return date as YYYY-MM-DD.
- If the full 4-digit year is clearly printed, use it exactly.
- If only MM/DD is visible with no year, default the year to ${currentYear()}.
- If no date is visible, return null.
${NUMERIC_DATE_RULE}

Doc type rules:
- RECEIPT: point-of-sale, grocery, restaurant, retail
- INVOICE: business-to-business, professional services, automotive
- STATEMENT: bank statement, account balance, financial summary
- DOCUMENT: any other financial document

Confidence rules:
- 0.95-1.00: clearly legible, unambiguous
- 0.80-0.94: legible with minor uncertainty
- 0.60-0.79: partially legible or inferred
- 0.00-0.59: not found or very unclear

For Canadian documents:
- GST = 5% federal tax
- HST = combined federal+provincial (13-15%)
- PST = provincial tax (6-10%)
Extract whichever tax types are present.

Return ONLY the JSON object. No markdown. No explanation.
`;
}

export class GeminiAdapter {
  private model = 'gemini-3.5-flash';
  private apiBase = 'https://generativelanguage.googleapis.com/v1beta';
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required');
    this.apiKey = apiKey;
  }

  async extractDocuments(
    imageBase64: string,
    mimeType = 'image/jpeg',
    attempt = 0
  ): Promise<ExtractionResult[]> {
    const url  = `${this.apiBase}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const body = {
      contents: [{ parts: [
        { text: buildMultiDocPrompt() },
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
      ]}],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    };
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      const e = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${e}`);
    }
    const data      = await response.json() as any;
    const candidate = data?.candidates?.[0];
    if (!candidate) throw new Error('Gemini returned no candidates');
    const finishReason = candidate.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      if (attempt < 1) return this.extractDocuments(imageBase64, mimeType, attempt + 1);
      throw new Error(`Gemini incomplete: finishReason=${finishReason}`);
    }
    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned empty text');
    return this.parseArray(text);
  }

  async extractDocumentsNoSchema(
    imageBase64: string,
    mimeType = 'image/jpeg',
    attempt = 0
  ): Promise<ExtractionResult[]> {
    return this.extractDocuments(imageBase64, mimeType, attempt);
  }

  async extractDocument(
    imageBase64: string,
    mimeType = 'image/jpeg',
    attempt = 0
  ): Promise<ExtractionResult> {
    const url  = `${this.apiBase}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const body = {
      contents: [{ parts: [
        { text: buildSingleDocPrompt() },
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
      ]}],
      generationConfig: {
        temperature: 0.1, maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT' as const,
          properties: {
            doc_type:           { type: 'STRING' as const, enum: ['RECEIPT','INVOICE','DOCUMENT','STATEMENT'] },
            vendor:             { type: 'STRING' as const, nullable: true },
            date:               { type: 'STRING' as const, nullable: true },
            total:              { type: 'NUMBER' as const, nullable: true },
            subtotal:           { type: 'NUMBER' as const, nullable: true },
            tax:                { type: 'NUMBER' as const, nullable: true },
            tax_gst:            { type: 'NUMBER' as const, nullable: true },
            tax_hst:            { type: 'NUMBER' as const, nullable: true },
            tax_pst:            { type: 'NUMBER' as const, nullable: true },
            payment_method:     { type: 'STRING' as const, nullable: true },
            category:           { type: 'STRING' as const, nullable: true },
            description:        { type: 'STRING' as const, nullable: true },
            issuer:             { type: 'STRING' as const, nullable: true },
            line_items: { type: 'ARRAY' as const, items: {
              type: 'OBJECT' as const,
              properties: {
                name:       { type: 'STRING' as const },
                quantity:   { type: 'NUMBER' as const },
                unit_price: { type: 'NUMBER' as const },
                total:      { type: 'NUMBER' as const },
              },
              required: ['name','quantity','unit_price','total'],
            }},
            confidence_vendor:   { type: 'NUMBER' as const },
            confidence_date:     { type: 'NUMBER' as const },
            confidence_total:    { type: 'NUMBER' as const },
            confidence_category: { type: 'NUMBER' as const },
          },
          required: ['doc_type','confidence_vendor','confidence_date','confidence_total','confidence_category'],
        },
      },
    };
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) {
      const e = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${e}`);
    }
    const data      = await response.json() as any;
    const candidate = data?.candidates?.[0];
    if (!candidate) throw new Error('Gemini returned no candidates');
    const finishReason = candidate.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      if (attempt < 1) return this.extractDocument(imageBase64, mimeType, attempt + 1);
      throw new Error(`Gemini incomplete: finishReason=${finishReason}`);
    }
    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned empty text');
    let parsed: any;
    try { parsed = JSON.parse(text); }
    catch (e: any) {
      const match = text.match(/\{[\s\S]+\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch { throw new Error(`Invalid JSON: ${e.message}`); } }
      else throw new Error(`Invalid JSON: ${e.message}`);
    }
    return this.validate(parsed);
  }

  private parseArray(text: string): ExtractionResult[] {
    let parsed: any;
    try { parsed = JSON.parse(text); }
    catch (e: any) {
      const match = text.match(/\[[\s\S]+\]/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch { throw new Error(`Invalid JSON array: ${e.message}`); } }
      else throw new Error(`Invalid JSON array: ${e.message}`);
    }
    if (!Array.isArray(parsed)) {
      if (parsed && typeof parsed === 'object') parsed = [parsed];
      else throw new Error('Gemini response is not a JSON array or object');
    }
    return parsed.map((item: any) => this.validate(item));
  }

  private validate(raw: any): ExtractionResult {
    const validTypes = ['RECEIPT','INVOICE','DOCUMENT','STATEMENT'];
    const doc_type   = validTypes.includes(raw.doc_type) ? raw.doc_type : 'DOCUMENT';

    // Validate the raw date through the year-range guard.
    const validatedDate = this.validateDate(raw.date);

    // Fix 2: if the raw date was rejected, set confidence_date = 0.
    // Prevents showing e.g. "Date 95%" in Review when the stored date is null.
    const rawConf         = this.clampConfidence(raw.confidence_date);
    const confidence_date = validatedDate === null ? 0 : rawConf;

    return {
      doc_type,
      vendor:             raw.vendor          ?? null,
      date:               validatedDate,
      total:              typeof raw.total    === 'number' ? raw.total    : null,
      subtotal:           typeof raw.subtotal === 'number' ? raw.subtotal : null,
      tax:                typeof raw.tax      === 'number' ? raw.tax      : null,
      tax_gst:            typeof raw.tax_gst  === 'number' ? raw.tax_gst  : null,
      tax_hst:            typeof raw.tax_hst  === 'number' ? raw.tax_hst  : null,
      tax_pst:            typeof raw.tax_pst  === 'number' ? raw.tax_pst  : null,
      payment_method:     raw.payment_method  ?? null,
      category:           raw.category        ?? null,
      description:        raw.description     ?? null,
      issuer:             raw.issuer          ?? null,
      line_items:         Array.isArray(raw.line_items) ? raw.line_items : [],
      raw_fields:         raw,
      confidence_vendor:   this.clampConfidence(raw.confidence_vendor),
      confidence_date,
      confidence_total:    this.clampConfidence(raw.confidence_total),
      confidence_category: this.clampConfidence(raw.confidence_category),
      gemini_model: this.model,
    };
  }

  private validateDate(d: any): string | null {
    if (!d || typeof d !== 'string') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const year    = parseInt(d.slice(0, 4), 10);
    const now     = new Date().getFullYear();
    if (year < now - 5 || year > now + 1) return null;
    return d;
  }

  private clampConfidence(v: any): number {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }
}
