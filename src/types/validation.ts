export type DocumentType =
  | 'invoice'
  | 'certificate_of_origin'
  | 'photo_plate'
  | 'photo_serial';

export type UploadSlotStatus = 'pending' | 'uploaded' | 'validated' | 'error';

export type ExpeditionStatus = 'validated' | 'with_observations' | 'manual_review';

export interface UploadedDocument {
  type: DocumentType;
  label: string;
  description: string;
  acceptedFormats: string;
  file: File | null;
  fileName: string | null;
  status: UploadSlotStatus;
  errorMessage?: string | null;
  required: boolean;
}

export interface ValidationMessage {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  text: string;
}

export interface ValidationResult {
  invoice_document_valid: boolean;
  certificate_document_valid: boolean;
  photo_plate_valid: boolean;
  photo_serial_valid: boolean;
  plate_match: boolean;
  serial_match: boolean;
  overall_status: ExpeditionStatus;
  messages: string[];
}

export interface SlotValidationResult {
  slot: DocumentType;
  document_valid: boolean;
  plate: string | null;
  serial: string | null;
  reason: string | null;
}

export interface ValidationChecklistItem {
  id: string;
  label: string;
  valid: boolean;
}
