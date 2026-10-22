import { clsx } from 'clsx';
import logo from '../assets/brand/logo-iti.png';
import logoDark from '../assets/brand/logo-iti-dark.png';
import mark from '../assets/brand/logo-mark.svg';

const NAME = 'Inline Technology';

/**
 * Inline Technology logo (dot mark + lettering). The lettering is dark grey, white in dark mode; `onDark` always uses
 * the white lettering (for a dark panel in either theme). Size it by height, e.g. "h-9".
 */
export function BrandLogo({ className, onDark }: { className?: string; onDark?: boolean }) {
  if (onDark) return <img src={logoDark} alt={NAME} className={clsx('w-auto', className)} />;
  return (
    <>
      <img src={logo} alt={NAME} className={clsx('w-auto dark:hidden', className)} />
      <img src={logoDark} alt={NAME} className={clsx('hidden w-auto dark:block', className)} />
    </>
  );
}

/** The dot mark alone, for small spots (collapsed sidebar, phone header). */
export function BrandMark({ className }: { className?: string }) {
  return <img src={mark} alt={NAME} className={clsx('object-contain', className)} />;
}
