import React from 'react';
import { api } from '../api';

interface Props {
  onImportComplete: () => void;
}

export default function ExcelUpload({ onImportComplete }: Props) {
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
          alert(`${result.imported}건이 성공적으로 임포트되었습니다.`);
          onImportComplete();
        }
        if (result.errors.length > 0) {
          alert(`오류 발생:\n${result.errors.slice(0, 10).join('\n')}${result.errors.length > 10 ? `\n... 외 ${result.errors.length - 10}건` : ''}`);
        }
        if (result.imported === 0 && result.errors.length === 0) {
          alert('임포트할 데이터가 없습니다.');
        }
      } catch (err: any) {
        alert(`임포트 실패: ${err.message}`);
      }
    };
    input.click();
  };

  return (
    <button className="btn btn-success" onClick={handleUpload}>
      엑셀 업로드
    </button>
  );
}
