export const metadata = {
  title: 'PhysioAI · Home',
  description: 'On-device AI physiotherapy for disabled persons in Thailand.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/shared/assets/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Gabarito:wght@700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/shared/assets/theme.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
