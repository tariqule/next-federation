/**
 * React's form-replay runtime: Fizz (`react-dom/server`) emits it as an inline
 * `<script>` before the first `<form>` whose `action` is a function, to queue
 * submits made before hydration. Island HTML never carries scripts, and an
 * island form is disabled until it hydrates, so it has nothing to replay: the
 * script is removed like any other, only without the NF-018 warning.
 *
 * Exact copies of `formReplayingRuntimeScript`, per React version. A React
 * release that changes it is warned about (NF-018) until its copy is added
 * here; never match it loosely, a script that only resembles it must warn.
 */
const REACT_FORM_REPLAY_SCRIPTS: ReadonlySet<string> = new Set([
  // react-dom 19.0 to 19.2
  `addEventListener("submit",function(a){if(!a.defaultPrevented){var c=a.target,d=a.submitter,e=c.action,b=d;if(d){var f=d.getAttribute("formAction");null!=f&&(e=f,b=null)}"javascript:throw new Error('React form unexpectedly submitted.')"===e&&(a.preventDefault(),b?(a=document.createElement("input"),a.name=b.name,a.value=b.value,b.parentNode.insertBefore(a,b),b=new FormData(c),a.parentNode.removeChild(a)):b=new FormData(c),a=c.ownerDocument||c,(a.$$reactFormReplay=a.$$reactFormReplay||[]).push(c,d,b))}});`,
  // react-dom 19.3
  `addEventListener("submit",function(a){if(!a.defaultPrevented){var b=a.target,d=a.submitter,c=b.action,e=d;if(d){var f=d.getAttribute("formAction");null!=f&&(c=f,e=null)}"javascript:throw new Error('React form unexpectedly submitted.')"===c&&(a.preventDefault(),a=new FormData(b,e),c=b.ownerDocument||b,(c.$$reactFormReplay=c.$$reactFormReplay||[]).push(b,d,a))}});`,
])

/** True only for an attribute-less script whose whole text is a known copy. */
export function isReactFormReplayScript(
  attrCount: number,
  text: string | null
): boolean {
  return attrCount === 0 && text !== null && REACT_FORM_REPLAY_SCRIPTS.has(text)
}
