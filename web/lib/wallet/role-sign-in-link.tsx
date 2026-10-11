"use client";

import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

export function RoleSignInLink({
  children,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { children: ReactNode }) {
  return (
    <Link
      href="/"
      {...props}
      onClick={(event) => {
        window.sessionStorage.setItem(
          "safepay-return-to",
          `${window.location.pathname}${window.location.search}`,
        );
        props.onClick?.(event);
      }}
    >
      {children}
    </Link>
  );
}
