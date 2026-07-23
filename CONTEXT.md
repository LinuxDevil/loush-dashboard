# Figma Capture & Annotation

A feature of the dashboard that pulls a design (screenshot + Figma nodes/metadata) from a Figma link, lets the user annotate regions of it with design-system component mappings and comments, and uses that annotated result to guide Claude when implementing the design.

## Language

**Capture**:
The saved bundle produced from one Figma link/frame: the rendered screenshot, the underlying Figma node tree, and file/frame metadata (fileKey, nodeId, frame name, fetch timestamp). Frozen at fetch time — no refresh/re-align mechanism; a changed design means a new Capture.
_Avoid_: Screen, Snapshot, Design

**Annotation**:
A user-drawn region over a Capture's screenshot, bound to a `component` reference and a single freeform `note`. Defaults to snapping to the underlying Figma node's bounding box when the user clicks a layer (capturing that node's id for free); freehand drag/resize overrides this for custom or grouped regions. May optionally reference a `parentId` (another Annotation) for composition, but nesting isn't a strict tree.
_Avoid_: Region, Mapping, Callout

**Component catalog**:
The list of design-system component names offered for autocomplete on an Annotation's `component` field, scraped from the `ct-web-design-system` docs site. Hybrid — freeform/custom text is also accepted when nothing in the catalog fits.
_Avoid_: Component list, Design system (that's the source library, not this cache)
