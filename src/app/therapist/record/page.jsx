import TherapistRecordClient from './TherapistRecordClient.jsx';

export const metadata = {
  title: 'PhysioAI · Data Recorder',
  description: 'Record labeled pose frames for therapist AI form-scoring datasets.',
};

export default function TherapistRecordPage() {
  return <TherapistRecordClient />;
}
