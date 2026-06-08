export const benefits = [
  {
    title: 'Clasificación de documento',
    description: 'Confirma si cada archivo corresponde al tipo documental requerido.'
  },
  {
    title: 'Consistencia del expediente',
    description: 'Compara placa y serial para detectar discrepancias entre soportes.'
  },
  {
    title: 'Decisión operativa',
    description: 'Genera un estado final: validado, observado o revisión manual.'
  }
];

export const flowSteps = [
  {
    title: '1. Carga de documentos',
    description: 'Adjunte factura, certificado de origen, fotoplaca y fotoserial.'
  },
  {
    title: '2. Validación de reglas',
    description: 'El sistema valida el tipo documental y la coherencia del expediente.'
  },
  {
    title: '3. Resultado y gestión',
    description: 'Revise observaciones y defina continuidad o revisión manual.'
  }
];

export const faqs = [
  {
    question: '¿Qué sucede si falta un documento?',
    answer: 'El expediente no puede validarse hasta completar los cuatro documentos obligatorios.'
  },
  {
    question: '¿Qué significa el estado observado?',
    answer: 'Existe inconsistencia parcial y el caso requiere revisión antes de continuar.'
  },
  {
    question: '¿Este portal ya consume APIs reales?',
    answer: 'No por ahora. La validación usa datos mock para pruebas funcionales.'
  }
];
