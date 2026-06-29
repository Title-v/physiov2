import TherapistCaptureClient from './capture/TherapistCaptureClient.jsx';

export const metadata = {
  title: 'PhysioAI · Therapist Setup',
  description: 'Capture therapist references, validate motion quality, and manage exercise setup.',
};

export default function TherapistPage() {
  return <TherapistCaptureClient />;
}
