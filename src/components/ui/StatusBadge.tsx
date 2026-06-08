import { ExpeditionStatus, UploadSlotStatus } from '../../types/validation';

interface StatusBadgeProps {
  status: ExpeditionStatus | UploadSlotStatus;
}

const statusMap: Record<StatusBadgeProps['status'], { label: string; className: string }> = {
  pending: {
    label: 'Pendiente',
    className: 'bg-slate-100 text-slate-700'
  },
  uploaded: {
    label: 'Cargado',
    className: 'bg-brand-light text-brand-secondary'
  },
  validated: {
    label: 'Validado',
    className: 'bg-emerald-100 text-emerald-700'
  },
  error: {
    label: 'Error',
    className: 'bg-rose-100 text-rose-700'
  },
  with_observations: {
    label: 'Observado',
    className: 'bg-amber-100 text-amber-800'
  },
  manual_review: {
    label: 'Revisión manual',
    className: 'bg-rose-100 text-rose-700'
  }
};

const StatusBadge = ({ status }: StatusBadgeProps) => {
  const data = statusMap[status];
  return <span className={`status-chip ${data.className}`}>{data.label}</span>;
};

export default StatusBadge;
