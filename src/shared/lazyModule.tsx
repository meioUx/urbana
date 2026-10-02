import React, { Suspense } from "react";
export function lazyModule<T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): T {
  const Component = React.lazy(loader);
  const Wrapped = (props: React.ComponentProps<T>) => (
    <Suspense
      fallback={
        <p className="muted" role="status">
          Carregando módulo...
        </p>
      }
    >
      <Component {...(props as any)} />
    </Suspense>
  );
  return Wrapped as unknown as T;
}
