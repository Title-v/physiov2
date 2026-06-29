import TherapistCaptureClient from './TherapistCaptureClient.jsx';

export const metadata = {
  title: 'PhysioAI · Therapist Setup',
  description: 'Capture therapist references, validate motion quality, and manage exercise setup.',
};

export default function TherapistCapturePage() {
  return <TherapistCaptureClient />;
}
