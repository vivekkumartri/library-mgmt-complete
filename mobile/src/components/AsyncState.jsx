import { useTranslation } from 'react-i18next';

export function Loading() {
  const { t } = useTranslation();
  return <div className="empty-state">{t('common.loading')}</div>;
}

export function ErrorState({ message, onRetry }) {
  const { t } = useTranslation();
  return (
    <div className="error-state">
      <p>{message || t('common.error')}</p>
      {onRetry && (
        <button className="btn btn-outline" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message }) {
  const { t } = useTranslation();
  return <div className="empty-state">{message || t('common.noResults')}</div>;
}
