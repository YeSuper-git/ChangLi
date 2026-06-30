import React from 'react';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div className="changli-modal-backdrop" onClick={onCancel}>
      <div className="changli-modal-panel" onClick={e => e.stopPropagation()}>
        <h3 className="changli-modal-title !mb-3 !text-xl">{title}</h3>
        <div className="text-sm text-gray-600 leading-6 mb-6">{message}</div>
        <div className="flex gap-3">
          <button
            type="button"
            className={`action-btn flex-1 text-sm ${danger ? 'action-btn-danger' : 'action-btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
          <button
            type="button"
            className="action-btn flex-1 text-sm"
            onClick={onCancel}
          >
            {cancelText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
