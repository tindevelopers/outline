import { cdnPath } from "@shared/utils/urls";

type Props = {
  /** The size of the icon, 24px is default to match standard icons */
  size?: number;
  /** The color of the icon, defaults to the current text color */
  color?: string;
  /** Whether the safe area should be removed and have graphic across full size */
  cover?: boolean;
};

export default function OutlineIcon({ size = 24 }: Props) {
  return (
    <img
      alt=""
      src={cdnPath("/images/icon-192.png?v=tin-vault-20260918")}
      width={size}
      height={size}
    />
  );
}
