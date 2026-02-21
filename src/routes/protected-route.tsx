// Protected route — auth removed, always renders children directly
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
