import { Button, Modal } from '../ui';

export function SegmentPasteDialog({
  lineCount,
  onChoose,
  onClose,
}: {
  lineCount: number;
  onChoose: (split: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      title="Paste text"
      size="sm"
      onClose={onClose}
      description="Keep the text in the first selected segment, or paste one line per selected segment?"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Button variant="secondary" onClick={() => onChoose(false)}>
          Keep line breaks
        </Button>
        <Button variant="primary" onClick={() => onChoose(true)}>
          Paste as {lineCount} segments
        </Button>
      </div>
    </Modal>
  );
}
