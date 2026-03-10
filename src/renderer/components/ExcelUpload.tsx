import React from 'react';

interface Props {
  onImportComplete: () => void;
}

export default function ExcelUpload({ onImportComplete }: Props) {
  const handleUpload = async () => {
    try {
      const result = await window.electronAPI.bulkImport();
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

  return (
    <button className="btn btn-success" onClick={handleUpload}>
      엑셀 업로드
    </button>
  );
}
