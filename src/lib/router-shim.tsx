import { Link as RouterLink, useNavigate, useRouterState } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, ReactNode } from "react";

/** Small wouter-style helpers on top of TanStack Router, used by the ELmarchii shell. */
export function useLocation(): readonly [string, (to: string) => void] {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  return [pathname, (to: string) => void navigate({ to: to as never })] as const;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children?: ReactNode;
};

export function Link({ href, children, ...rest }: LinkProps) {
  return (
    <RouterLink to={href as never} {...(rest as Record<string, unknown>)}>
      {children}
    </RouterLink>
  );
}
