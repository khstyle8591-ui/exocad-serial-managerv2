import React from 'react';
import { api } from '../api';
import { useLang } from '../App';
import { t } from '../i18n';

interface Props {
  onImportComplete: () => void;
}

export default function ExcelUpload({ onImportComplete }: Props) {
  const { lang } = useLang();
  const handleUpload = async () => {
    // 웹서버 모드: <input type="file"> 으로 파일 선택 후 raw buffer POST
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const result = await api.bulkImport(file) as any;
        if (result.imported > 0) {
          alert(t(lang, 'excel_import_success').replace('{n}', String(result.imported)));
          onImportComplete();
        }
        if (result.errors.length > 0) {
          alert(t(lang, 'excel_import_errors').replace('{errors}', result.errors.slice(0, 10).join('\n')) + (result.errors.length > 10 ? t(lang, 'excel_import_more').replace('{n}', String(result.errors.length - 10)) : ''));
        }
        if (result.imported === 0 && result.errors.length === 0) {
          alert(t(lang, 'excel_import_empty'));
        }
      } catch (err: any) {
        alert(t(lang, 'import_failed').replace('{error}', err.message));
      }
    };
    input.click();
  };

  return (
    <button className="btn btn-success" onClick={handleUpload}>
      {t(lang, 'excel_upload')}
    </button>
  );
}
