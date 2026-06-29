export const NEXT_API_ROUTES = [
  {
    method: 'GET',
    path: '/health',
    file: 'src/app/health/route.js',
  },
  {
    method: 'POST',
    path: '/auth/register',
    file: 'src/app/auth/register/route.js',
  },
  {
    method: 'POST',
    path: '/auth/resend-verification',
    file: 'src/app/auth/resend-verification/route.js',
  },
  {
    method: 'POST',
    path: '/auth/login',
    file: 'src/app/auth/login/route.js',
  },
  {
    method: 'GET',
    path: '/auth/me',
    file: 'src/app/auth/me/route.js',
  },
  {
    method: 'GET',
    path: '/patients',
    file: 'src/app/patients/route.js',
  },
  {
    method: 'POST',
    path: '/patients/link',
    file: 'src/app/patients/link/route.js',
  },
  {
    method: 'POST',
    path: '/patients',
    file: 'src/app/patients/route.js',
  },
  {
    method: 'GET',
    path: '/plans',
    file: 'src/app/plans/route.js',
  },
  {
    method: 'PUT',
    path: '/plans',
    file: 'src/app/plans/route.js',
  },
  {
    method: 'GET',
    path: '/references',
    file: 'src/app/references/route.js',
  },
  {
    method: 'POST',
    path: '/references',
    file: 'src/app/references/route.js',
  },
  {
    method: 'DELETE',
    path: '/references',
    file: 'src/app/references/route.js',
  },
  {
    method: 'GET',
    path: '/sessions',
    file: 'src/app/sessions/route.js',
  },
  {
    method: 'POST',
    path: '/sessions',
    file: 'src/app/sessions/route.js',
  },
];
