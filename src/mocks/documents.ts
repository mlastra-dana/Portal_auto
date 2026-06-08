import { DocumentType, UploadedDocument } from '../types/validation';

export const documentSlotsSeed: UploadedDocument[] = [
  {
    type: 'invoice',
    label: 'Factura',
    description: 'Documento fiscal de compra de la motocicleta.',
    acceptedFormats: 'PDF, JPG o PNG',
    file: null,
    fileName: null,
    status: 'pending',
    errorMessage: null,
    required: true
  },
  {
    type: 'certificate_of_origin',
    label: 'Certificado de origen',
    description: 'Soporte del origen y características del vehículo.',
    acceptedFormats: 'PDF, JPG o PNG',
    file: null,
    fileName: null,
    status: 'pending',
    errorMessage: null,
    required: true
  },
  {
    type: 'photo_plate',
    label: 'Fotoplaca',
    description: 'Imagen legible de la placa de la motocicleta.',
    acceptedFormats: 'JPG o PNG',
    file: null,
    fileName: null,
    status: 'pending',
    errorMessage: null,
    required: true
  },
  {
    type: 'photo_serial',
    label: 'Fotoserial',
    description: 'Imagen legible del serial o VIN del vehículo.',
    acceptedFormats: 'JPG o PNG',
    file: null,
    fileName: null,
    status: 'pending',
    errorMessage: null,
    required: true
  }
];

export const expectedDocumentTypeHints: Record<DocumentType, string[]> = {
  invoice: ['factura', 'invoice', 'compra'],
  certificate_of_origin: ['origen', 'certificate', 'certificado'],
  photo_plate: ['placa', 'plate', 'fotoplaca'],
  photo_serial: ['serial', 'vin', 'fotoserial']
};
