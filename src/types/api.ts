import { DocumentType, ExpeditionStatus } from './validation';

export type PhaseAction = 'validate_documents' | 'validate_images' | 'compare_expedient';

export interface SlotExtraction {
  document_valid: boolean;
  plate: string | null;
  serial: string | null;
  reason: string | null;
}

export interface PhaseResponseBase {
  success: boolean;
  message?: string;
  expedient_id?: string;
  phase?: 'documents' | 'images';
  raw_extractions?: Partial<Record<DocumentType, SlotExtraction>>;
  frontend_required?: Partial<Record<DocumentType, SlotExtraction>>;
  persisted_extraction?: {
    bucket: string;
    key: string;
  } | null;
  persisted_extractions?: Partial<
    Record<
      DocumentType,
      {
        bucket: string;
        key: string;
      }
    >
  >;
  persisted_summary?: {
    bucket: string;
    key: string;
  } | null;
}

export interface ValidateDocumentsResponse extends PhaseResponseBase {}

export interface ValidateImagesResponse extends PhaseResponseBase {}

export interface CompareExpedientResponse extends PhaseResponseBase {
  document_validation?: {
    invoice_valid?: boolean;
    certificate_of_origin_valid?: boolean;
    photo_plate_valid?: boolean;
    photo_serial_valid?: boolean;
  };
  extracted_data?: {
    invoice_plate?: string | null;
    certificate_plate?: string | null;
    photo_plate?: string | null;
    invoice_serial?: string | null;
    certificate_serial?: string | null;
    photo_serial?: string | null;
  };
  cross_validation?: {
    plate_match?: boolean | null;
    serial_match?: boolean | null;
    same_expedient?: boolean | null;
  };
  overall_status?: ExpeditionStatus | 'validated' | 'manual_review';
  messages?: string[];
}
