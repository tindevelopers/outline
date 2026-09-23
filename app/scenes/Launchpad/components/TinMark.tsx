import styled from "styled-components";
import { cdnPath } from "@shared/utils/urls";

const Tile = styled.span<{ $size: number }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  border-radius: ${({ $size }) => Math.round($size / 4)}px;
  background: #ffffff;

  img {
    display: block;
    width: 75%;
    height: auto;
  }
`;

type Props = {
  /** Pixel size of the square tile. */
  size?: number;
};

/**
 * The official TIN logo on a white tile, so it reads on any background.
 *
 * @returns The logo element.
 */
export function TinMark({ size = 64 }: Props) {
  return (
    <Tile $size={size}>
      <img src={cdnPath("/images/tin-logo.png")} alt="TIN" />
    </Tile>
  );
}
