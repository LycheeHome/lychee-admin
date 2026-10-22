import { useQuery } from "@tanstack/react-query";
import { boardQueryKey, fetchBoard } from "../api";
import { useBoardControls } from "../mutations";
import { Board } from "../components/BoardRows";
import { FRAME_WIDTH } from "../../views/shared";

/** The add-site page's error treatment, visible. */
const ALERT = "font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0";

/**
 * /infrastructure. Nothing while the first answer is on its way: a skeleton
 * is the redesign's call, not the foundation's.
 */
export function InfrastructurePage() {
  const query = useQuery({ queryKey: boardQueryKey("infrastructure"), queryFn: () => fetchBoard("infrastructure") });
  const controls = useBoardControls();

  if (query.isError) {
    return (
      <div className={`${FRAME_WIDTH} flex flex-col gap-8`}>
        <p role="alert" className={ALERT}>
          {query.error.message}
        </p>
      </div>
    );
  }
  if (!query.data) return null;
  return <Board payload={query.data} group="infrastructure" controls={controls} />;
}
