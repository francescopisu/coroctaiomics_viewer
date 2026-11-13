# Coronary / CPE viewer

Standalone browser viewer for **one configured case at a time** (currently case **1718**). Five linked views: 3D coronary overview on the left; independently rotating straightened reconstruction and curved CPR in the center; orthogonal cross-section above native axial CCTA on the right. Vessel-specific radiomic feature maps can overlay the CCTA. All source medical data and the CoroCTAiomics pipeline are read-only. Generated files stay here.

## Local startup

Use Python **3.9+**, Node **20.19+ / 22.12+**, and a WebGL2 browser. The external drive must be mounted when inspecting or preparing the cache. The existing Python environment and node_modules have already been installed in this project.

From the parent `viewer/` directory:

```sh
cd coronary_viewer
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
.venv/bin/python -m backend.prepare
npm run build
.venv/bin/python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000 --no-access-log
```

Open **http://127.0.0.1:8000/**. Build the frontend before starting this single-server mode. The backend serves only allowlisted generated case assets and the built frontend; it does not expose arbitrary source paths, accept file uploads, or modify data.

For frontend development, run the backend in one terminal and `npm run dev` in another. Open **http://127.0.0.1:5173/**; Vite proxies `/api` to the backend. Bind to loopback as shown.

The first page load shows a horizontal 0–100% indicator. Metadata completes the first 2%; decoded bytes for all 3D meshes, all three vessels' native masks/display fields and the single shared native CT/packed-label stack account for the next 96%. Expected sizes come from geometry, so gzip transfer sizes do not cause percentage overshoot. Download streams copy directly into their final buffers. The final 2% completes after all initial views are ready and two animation frames have passed; 100% remains briefly visible before the overlay fades. Controls are inert until startup completes. All vessel data are ready before the controls become active. A feature map loads on its first selection, then remains cached for the current case. Failed startup requests expose the normal error/Reload control instead of falsely reaching 100%.

## Data configuration and cache

`config/case.local.json` contains the absolute source paths. Override its location with `CORONARY_CASE_CONFIG=/absolute/path/to/config.json`. The patient ID selects that case’s prepared cache; the server exposes only the currently configured case. The frontend contains no `/Volumes/` paths.

### Switching the configured CCTA

1. Update **all matching case fields** in `config/case.local.json`: `patientId`, `ct`, `outputRoot`, each `centerlineFiles` entry, and `radiomicFeatureMaps` if used. Centerline branch suffixes can differ between patients; inspect the actual `labeling/` directory. For case 1718 the verified files are `1718_LAD_1.csv`, `1718_LCx_2.csv`, and `1718_RCA_1.csv`.
2. From `coronary_viewer/`, run `.venv/bin/python -m backend.prepare`. This validates alignment and regenerates only the selected case's cache when needed.
3. **Reload the browser.** No frontend rebuild or server restart is required for subsequent data-only changes.

Editing the JSON is not a live image replacement. The frontend requests `/api/case`, which resolves the configured patient ID and returns that case’s prepared HTTP URLs. The API rejects a missing or stale cache with a preparation instruction instead of silently serving a previous patient. A configuration digest covers the JSON and pipeline defaults. Mixed patient IDs, CCTA filenames, output directories and centerline filenames are rejected during preparation. The backend’s axial memory-map cache includes the preparation revision, so rebuilding a case reopens its arrays. Configuration/source edits during preprocessing abort manifest publication.

The discovery code parses literal assignments from the pipeline's `config/defaults.py` with Python's AST. It does not import the pipeline, initialize torch, or edit global defaults. Directory names and MPR settings come from that file. CPE discovery refuses a configuration other than `periluminal_r4`. Neither `periluminal` nor `periluminal_r4_PCAT` is used.

Preparation fingerprints the source paths, sizes, modification times and configuration. An unchanged case reuses its cache. `python -m backend.prepare --force` regenerates display assets; it never writes source files. Missing files fail explicitly, including a missing `/Volumes/X9Pro` mount. An existing prepared cache can be viewed without the external drive; it is a local derivative of the configured case, never substitute data.

The cache retains native marching-cubes meshes and separate smoothed display meshes for the postprocessed lumen masks, three authoritative CPE masks, and ascending aorta shell. Display surfaces use VTK windowed-sinc smoothing (40 iterations, passband 0.03, normalized coordinates, boundary/feature/nonmanifold smoothing off), with consistent point normals and Phong shading. Connectivity is retained; there is no mesh decimation or source-mask overwrite. The manifest records maximum vertex displacement. For case 1718 it is 0.37–0.48 mm, and enclosed volume changes are below 0.7%. Layers → Smooth meshes restores the original mesh when disabled. This is an established VTK display method, not a claim to reproduce Elucid’s proprietary implementation. Optional source VTPs are inspected but not used for display.

Interactive CPR shares the full native CT buffer and its VTK image with axial viewing. It downloads and retains all three vessels' lumen/CPE mask crops and smooth display fields during startup. CT crop assets remain diagnostic references and are no longer downloaded by the viewer. The CPU sampler converts crop indices to the shared native CT grid, preserving trilinear sampling, native HU, crop boundary behavior and physical LPS coordinates. Masks retain their original crop geometries and interpolation policies. The two central viewports use one WebGL context; their CT texture remains the same object when the selected vessel changes. Clicking the 3D model or changing the vessel selector switches resident data without a request or a Loading placeholder. All resources are released when the case closes. Startup retains more mask data, while sharing CT avoids three duplicate CT crops. For case 1718, resident vessel masks/display fields total about 426 MB and the shared native CT/packed-label stack about 270.5 MB before textures and meshes. No spatial downsampling is used; integer HU are compacted losslessly and fractional HU retain Float32.

For axial viewing, preprocessing exports the complete native CT stack and a packed mask stack in x-fast voxel order under `cache/{patientId}/`. The browser downloads both once during the initial progress bar and retains them in memory for every vessel and native k slice. CT is compacted to Int16 only when all HU are preserved exactly; fractional HU retain Float32. Slice CT arrays are zero-copy views into the resident stack, and lumen/CPE masks are decoded locally. The selected radiomic map also supplies native axial values, support and display boundaries directly from its already loaded crop. There are no per-slice HTTP requests, transient Loading frames, or a 16-slice eviction limit during navigation. Case 1718 adds about 270.5 MB of resident axial CT/packed labels. Existing valid caches are upgraded by `python -m backend.prepare` using their saved native arrays without regenerating meshes. The read-only `/api/cases/{patientId}/axial/{k}` and feature axial endpoints remain available for diagnostics and sampling checks; the internal NumPy arrays remain unlisted. Earlier fixed reformats are diagnostic references.

### Radiomic feature maps

The optional `radiomicFeatureMaps` configuration key points to a directory containing vessel subdirectories `LAD`, `LCx`, and `RCA`. `LM-LAD` is accepted as an alias for `LAD`; having both is rejected as ambiguous. Each directory's `.nii.gz` files appear only for that vessel, using their original feature names. macOS `._` resource forks are ignored. Case 1718 has three LAD, two LCx and three RCA maps.

After changing this directory or its files, run preparation and reload the browser. Preparation fingerprints every discovered map and requires its shape and physical affine to match the CCTA. A mismatched map fails explicitly rather than guessing registration. Display derivatives keep native voxel spacing and crop only the bounding box around the authoritative vessel CPE. Values are stored as Float32; original NIfTI files remain untouched. Per-feature 2nd/50th/98th percentiles are calculated from finite CPE voxels for the optional display stretch. Support is the corresponding `periluminal_r4` CPE intersected with finite feature values. Zero is valid, including zero-valued CPE voxels; NaN/Inf and voxels outside the CPE are transparent. The manifest records in-CPE extrema, zero/invalid counts, and nonzero values outside the CPE within the crop. Some supplied case-1718 maps have nonzero values outside the current CPE, so explicit clipping is necessary.

Choose a map using the toolbar selector; **No feature map** restores the existing CPE display. Selection is remembered separately for each vessel. Each map is fetched once when first selected and retained for the current case, including its VTK images; returning to that map or vessel restores it without another download or a map-loading placeholder. Concurrent requests for the same map share one promise, and closing the case aborts pending requests and releases cached resources. The provided 256-color green–white–pink palette uses stops `#3b9b38`, `#4daf4a`, `#ffffff`, `#f781bf`, `#e66aac`.

**Balanced** is the default display scale: each feature's 2nd percentile maps to green, its median to white, and its 98th percentile to pink. Separate linear stretches below/above the median give both halves of the distribution visible contrast; extrema beyond the percentile endpoints are saturated for display only. The three legend labels are actual feature values, including the white median. Green means lower relative values in this mode, and does not imply negative values. Ties, zero padding within the CPE and constant maps can prevent perfectly equal color counts. **Raw zero** preserves the original sign interpretation and symmetric `[-M, +M]` range, with `M = max(abs(min), abs(max))` (1 for an all-zero map). Zero is white in Raw zero; a positive-only feature legitimately uses white/pink. No source values, features, inference or analytical masks are changed. Scale statistics remain fixed during navigation and rotation.

The selected feature overlays both CPRs, the fixed orthogonal slice, native axial CCTA, and the optional 3D cross-sectional plane. Feature scalars are interpolated before color mapping: trilinearly in the CPR and orthogonal plane, bilinearly during axial display enlargement. Interpolation is normalized by finite CPE support, so masked-out background and NaN neighbours do not dilute boundary values toward zero. CPU and GPU share the same scale parameters and colormap. The GPU stores scalar/support channels, divides by interpolated support, and applies its color transfer function afterward. A small OpenGL CPR view-node extension supplies the final color stage and rebuilds it when scale parameters change; vtk.js 37.4.1’s CPR renderer does not apply the generic shader-replacement hook. Its native coordinate/orientation/sampling stages are retained. Original finite zeros remain valid. The 3D vessel surfaces retain territory colors.

**CPE masks** in the toolbar independently toggles all binary CPE display surfaces, fills and contours, preserving vessel-specific selections in Layers. Feature maps remain visible when masks are hidden. **Layers → Map opacity** adjusts the map independently. Rotation resamples the map while orthogonal/axial orientation remains fixed. PNG export includes the feature name, scale mode and all three numeric anchors.

**Layers → Smooth edges** controls a separate boundary display derivative, enabled by default. A physical Gaussian kernel with sigma 0.35 mm produces a continuous CPE field; its 0.5 contour, antialiased coverage and rounded vector paths replace voxel steps and suppress thin spurs/small specks. The map is clipped to the same display field. Smoothing can hide small source-mask fragments or shift the displayed edge; disable Smooth edges to inspect the original voxel support. Binary sampling and source NIfTI labels stay unchanged. Display fields are generated independently in each native vessel crop, with halo padding in feature crops.

The optional ascending aorta is discovered at `outputRoot/cardiac_structures/asc_aorta_shell.nii.gz`. An explicit `ascendingAorta` path can override it; a missing explicit path fails preparation. Its own NIfTI affine maps the surface to physical LPS. Layers provides Ascending aorta visibility and opacity; it is included in the 3D camera fit and PNG export. Existing cases without this optional file still load.

### Interaction

- Drag horizontally in **Curved CPR** to rotate around the vessel's longitudinal axis. Each central reconstruction has an independent rotation angle. Rotation in one panel does not rotate the other, the orthogonal cross-section, its 3D plane, or axial CCTA. All views continue to share the selected vessel and longitudinal position.
- Drag horizontally in **Straightened** to rotate its plane around the transported local tangent; click or drag vertically to select a longitudinal position. Gesture direction locks after a small movement threshold, so starting a rotation does not move the selected slice. Click a row in Curved CPR or scroll either reconstruction to navigate. All five views follow the same centerline sample.
- The curved panel uses vtk.js stretched CPR: the vessel retains lateral curvature, and longitudinal display distance is projected perpendicular to its current sampling direction. Its marker uses these projected distances, not a guessed image fraction.
- Select LAD, LCx or RCA in the toolbar or click a vessel in 3D. Clicking axial CCTA selects the nearest centerline sample in physical space.
- **Layers** holds lumen/CPE/centerline visibility, opacity, color and optional 3D plane controls. **W/L** change the shared CT window. **Reset** restores the camera and zero rotation in both central views. **Export** saves all five views.

The imaging workspace keeps its minimal toolbar, panel names, rotation angle, orientation letters and scale references. **AI**, beside Layers, opens a compact nonmodal results panel over the lower-left view. Opening it preserves the size, camera and current position of all five views. Close with ×, the AI button or Escape; tab navigation supports arrow keys. Scientific interpretation and implementation details are documented here.

### AI patient summary

The AI panel shows the configured patient's **PRI-only** and **adjusted** 4-year MACE probabilities and the **PRI-only risk stratum**. Patient, Features and Cohort tabs keep secondary information separate from the persistent predictions. Results load only on first opening; reopening the panel uses the resident result. AI errors/retry stay inside this panel and do not interrupt imaging. The existing PNG Export continues to export the five imaging views, without the AI overlay.

- **Patient:** recorded age, sex, ESC RF-CL percentage/class, full CAD-RADS, Agatston score, smoking, hypertension, diabetes, dyslipidemia, dyspnea, chest-pain presentation, CAD family history and BMI. The stored likelihood/class are displayed without recalculation. Unknown, absent and explicitly unspecified information is preserved; none is interpreted as a negative finding. Family history and the other report-only fields do not enter the models. The adjusted model uses the original continuous `Clinical Likelihood` and binary `SS45`, which is a separate field from full CAD-RADS.
- **Features:** all eight native patient-level radiomic values, grouped by vessel, alongside HRs from the chosen PRI-only/adjusted model. Hover or focus an HR for its 95% interval and fitted association direction. These HRs are per training SD after preprocessing, conditional on the other model predictors, not local voxel risk. Clicking a feature selects its available vessel/map in the viewer. Map colors retain their existing numerical meaning.
- **Cohort:** derivation patient/event counts, median age and percentage of women, plus patient-versus-median comparisons and empirical percentiles for age, Agatston and RF-CL. Percentiles exclude missing values and use midrank for ties. Calcium-score availability is shown explicitly.

The PRI bar has **25% / 50% / 25%** segments and the study's right-closed boundaries: Low ≤ Q25, Intermediate Q25 < risk ≤ Q75, High > Q75. Thresholds are read from the saved **out-of-fold derivation** configuration (currently 6.4473% and 10.5730% at 48 months), cross-checked against the PRI bundle. Hover a band/tick to see the threshold. The white marker indicates category membership, centered in the assigned band. An exact PRI percentile is intentionally not inferred from the two thresholds or from in-sample refitted risks; the original out-of-fold risk distribution is not supplied. The age/calcium/RF-CL percentiles are actual empirical values.

### AI data and model preparation

`config/ai.local.json` points to the derivation and validation CSVs, two trusted local saved model bundles, and study threshold JSON. Override with `CORONARY_AI_CONFIG`. AI configuration is separate from imaging configuration, so it does not invalidate or rebuild CT/mesh caches. Patient IDs must be unique across the two datasets; the endpoint returns only the record matching the currently configured imaging case. An absent patient gets an explicit unavailable result, never a demonstration patient. Source paths, reference distributions, model files and all-patient data are not exposed over HTTP.

Prepare AI data once in an analysis environment. In this workspace `.venv-ai` uses the existing analysis environment with a project-local neuroCombat dependency; the export command is:

```sh
PYTHONDONTWRITEBYTECODE=1 .venv-ai/bin/python -m backend.export_ai
```

To create an independent export environment instead, use Python 3.10+:

```sh
python3.10 -m venv .venv-ai
.venv-ai/bin/python -m pip install -r requirements-ai.txt
.venv-ai/bin/python -m backend.export_ai
```

This command **does not fit models or execute the notebook**. It reads trusted local bundles using pandas' legacy pickle compatibility reader, extracts numerical parameters for site-only ComBat, saved scaling, the Cox coefficients/centering and baseline cumulative hazard, then validates predictions against neuroHarmonize and the saved lifelines models for every complete record and single-record site cases. Old serialized sklearn estimators are never invoked. For the supplied 1,410 records, both models match within 3.4 × 10⁻¹⁶ absolute risk. Only after validation does it atomically publish `cache/ai/reference.json`; no source data, notebooks, pickles or thresholds are modified. The main `.venv` needs no additional inference dependencies and never unpickles a model on an HTTP request.

Inference uses a fixed model schema. In particular, **continuous RF-CL stays numeric even for a single patient**, correcting the notebook helper's `nunique() <= 10` categorical inference for integer clinical fields. This agrees with the batch/reference model; patient 96's corrected adjusted risk is 11.4899%, rather than the notebook's saved 13.19% example. Patient 1718 is currently 12.4859% PRI-only, 10.9402% adjusted, High PRI stratum. These are model outputs, not historical patient outcomes.

Historical `TIME` and `EVENT` values never enter inference or patient responses. The adjusted notebook's numeric imputer includes these outcome columns in its saved design, so this integration requires all eight radiomic inputs, known KVP and (for adjusted risk) recorded RF-CL/SS45. Missing predictors or unseen KVP explicitly disable the affected prediction rather than using outcome-dependent imputation. Supporting incomplete model inputs would require a reviewed, outcome-free preprocessing artifact; reporting fields may remain missing without blocking inference.

Repeat export after changing CSVs, models, threshold files or AI configuration, then reload the page. Mounted source changes are detected by size/modification fingerprints and rejected until re-export. A validated cache remains usable when source storage is unmounted. The AI cache contains patient records and is covered by `cache/` in `.gitignore`; do not distribute it as a frontend asset.

## Inspection findings

`python -m backend.inspect_case` writes `cache/inspection.json` with all required image headers, geometry, alignment diagnostics and VTP metadata. The following table records the original case-1 inspection. The JSON report always describes the currently prepared case:

| Item | Finding |
| --- | --- |
| CT and six display masks | 512 × 512 × 416; identical affines and grids |
| Spacing | 0.431640625 × 0.431640625 × 0.300000012 mm |
| Physical LPS origin | (−73.284179688, −318.284179688, −346.5) mm |
| LPS direction | Identity; qform and sform codes both 1 |
| Labelled CSV columns | `x,y,z,radius,zone`; explicit field parsing |
| Slicer markups | LPS, mm; matching CSV points |
| LAD | 50 source points; 49.4467 mm; every point inside lumen |
| LCx | 78 CSV points; 76.6888 mm; every point inside lumen |
| RCA | 111 source points; 109.4918 mm; every point inside lumen |
| Centerline to nearest lumen voxel | Maxima: LAD 0.2930 mm; LCx 0.3020 mm; RCA 0.2944 mm |
| CPE/lumen overlap | Zero voxels for all three vessels |
| CPE voxel counts | LAD 60,592; LCx 58,304; RCA 97,920 |

LCx markup has 79 points: it includes an extra initial point absent from the 78-row CSV. All CSV points match markup positions. CSV order and origin are authoritative for navigation; the viewer does not silently prepend that extra point.

Subtree VTPs are triangle surfaces with `Labels` and `Normals`, and no cell or field data. Combined centerline VTPs contain 4 left / 2 right polylines and `MaximumInscribedSphereRadius`, `EdgeArray`, `EdgePCoordArray`, `TCoords`; no anatomical branch labels or coordinate-system field. Their native points align as LPS (median distance to lumen voxels about 0.19–0.23 mm); treating them as RAS instead misses by hundreds of millimetres. The source MRML refers to lumen volumes and centerline markups, with no corresponding transform references found; it is not a runtime dependency.

The MPR implementation allocates `(mpr_width, mpr_width, centerline_count)` and multiplies transverse pixel offsets by `mpr_voxelsize`. **MPR_WIDTH = 50 is pixels, not millimetres:** the default field of view is 25 mm. Pixel centres span −12.25…+12.25 mm; image support spans 25 mm.

The periluminal extractor multiplies local radii by four, subtracts the lumen, and clips against dilated cardiac, pulmonary and additional masks. LCx also gets an origin skip based on 1.5 times a nearby LAD radius. Saved CPEs can therefore be incomplete shells. The UI shows the exact saved masks rather than rebuilding the ideal mathematical envelope. The nominal 50 mm length, CSV length and range of cross-sectional planes intersecting the CPE are distinct. The latter can extend beyond 50 mm because a curved outer envelope intersects later planes; the diagnostic manifest records this as `cpeSliceRangeMm`, independently of nominal analyzed length.

## Coordinate and sampling contract

All geometry in the viewer uses **physical LPS millimetres**. Nibabel's affine maps voxel-centre indices to RAS. We use:

```text
F = diag(−1, −1, 1, 1)
A_LPS = F × A_NIfTI_RAS
p_LPS = A_LPS × [i, j, k, 1]
ijk = inverse(A_LPS) × [p_LPS, 1]
```

The CSV already contains LPS coordinates, verified by its associated markup and by lumen occupancy. No visual axis flipping or additional half-voxel offset is applied. Nibabel arrays are indexed `data[i,j,k]`; mesh vertices and reslices follow that convention. Out-of-volume CCTA sampling returns −1024 HU, labels return 0.

Centerlines are resampled linearly by physical arc distance, preserving path order. Local tangents use centred finite differences. Transverse U/V axes use minimal-rotation parallel transport and orthonormalization, with an explicit error on a direction reversal. The straightened mapper uses these per-point orientations; its sampling direction is `cos(straightAngle) U + sin(straightAngle) V`. The orthogonal plane samples `P(s) + u U(s) + v V(s)` from the same native volume, independently of both central rotation angles, with trilinear CT and nearest-neighbour masks. It also drives the optional 3D plane and ring.

The per-point straightened orientation array contains normalized **four-component quaternions with continuous signs** (`dot(q[i-1], q[i]) >= 0`). Rotation matrices converted independently can produce opposite-sign quaternion pairs for nearby frames, even though the physical orientations are smooth. The vtk.js 37 GPU interpolation path does not correct those sign changes; it can interpolate the long rotation and produce narrow horizontal sampling seams. The viewer resolves this ambiguity before uploading orientations, preserving the exact original frame axes. Regression tests exercise the actual case-1 LCx/RCA sign-change locations and compare GPU-style interpolation to independent shortest-arc interpolation. The curved uniform-orientation renderer does not have this adjacent-frame ambiguity.

The curved mapper uses `vtkImageCPRMapper.useStretchedMode` with a uniform sampling direction perpendicular to the vessel's first-to-last chord. A normalized quaternion rotates that direction; the GPU uniform requires four quaternion components even though the core orientation API also accepts matrices. The shader samples `P(s) + (x + dot(C-P(s), D)) D`. Its width is fixed for the entire rotation envelope: `25 + 2 × max(distance of P−C perpendicular to the chord)` mm, where C is the mean centerline point. Crop bounds already cover this full envelope. The selected curved marker is at `width/2 + dot(P-C,D)` horizontally and the corresponding projected centerline distance vertically. This is a single curved reformation, not a MIP or a slab average.

The curved CPR yellow section marker is a single straight segment through the selected vessel point. Its angle comes from the selected orthogonal U/V frame and the local tangent plane of the stretched CPR, including the longitudinal display scale. With unit frame normal N, sampling direction D and scale k, its mapper direction is `(length(cross(N,D)), dot(N,D) × k)`. After projection, its displayed length is fixed at 96 CSS pixels (capped at 36% of the smaller panel dimension for small views). It is an orientation indicator; its displayed length does not represent a physical diameter or FOV. Length is independent of rotation and the stretched longitudinal scale. This local orientation guide remains straight through vessel bends; tracing the entire orthogonal plane across the curved ribbon previously produced wavy markers. The straightened marker stays horizontal. Both markers and their center dots are also drawn in PNG export; changing CPR rotation does not rotate the orthogonal frame itself.

Both central views sample the same fixed vessel-dependent width given above, so their CT image rectangles match horizontally. The straightened FOV expands to the full rotation envelope; its vessel remains centered, with additional surrounding CCTA visible. Existing native crops already cover this sampling width. Both views have the same longitudinal display extent, `displayHeight = max(CSV_length, fixed_curved_width / viewport_aspect)`, and share one camera scale. The camera contains the complete image rectangle and reserves half the screen marker length plus 8 CSS pixels around the full centerline rotation envelope and the longitudinal ends. This padding and the camera scale are computed per vessel and viewport, independently of the rotation angle. Horizontal pixels per millimetre are identical between panels and remain constant during rotation. The longitudinal coordinates are scaled by `displayHeight / mapper_height`, preserving the requested matched, full display heights even when a wide rotation envelope controls camera fit; this axis is therefore a display coordinate, not an isotropic measurement surface. Native sampling resolution, arc/projected-distance lookup, point selection and the 3D marker remain unchanged. The former angle-dependent width and per-view `CSV_length × view_width / 25` fitting caused artificial vessel thinning through rotation; this combination has been removed. Real contour differences can remain because a uniform stretched-CPR sampling direction is not generally perpendicular to every local tangent; use the linked orthogonal section to assess a true transverse diameter.

Straightened CPR rotates a local sampling plane along the path, so distant background can be stretched, compressed or folded. Matching the straightened FOV to the curved rotation envelope makes this much more visible than a narrow vessel-focused strip. For case-1718 RCA the width is about 80.4 mm; at 6° and 40.2 mm lateral offset, consecutive 0.5 mm centerline samples can reach source positions about 6.34 mm apart. This is geometric distortion, with additional aliasing when output pixels span multiple native CT voxels. Frame quaternions remain sign-continuous; this is separate from the earlier quaternion seam bug.

**Layers → Pixel antialiasing** enables adaptive pixel-footprint filtering of the straightened CCTA, on by default. The fragment shader estimates native-voxel footprint using screen derivatives of the 3D sampling coordinates before the volume-bounds branch. It integrates 1–16 trilinear CT samples along the dominant footprint direction before windowing. Pixels spanning no more than one native voxel retain the original single sample. This is a display prefilter, not a through-plane MIP/AVG slab; the centerline, transported frames, coordinates, source CT, masks, feature values, curved CPR and orthogonal/axial slices are unchanged. Broad geometric distortion remains; antialiasing reduces fine undersampling artifacts rather than reconstructing undistorted distant anatomy. The toggle restores the unfiltered rendering for comparison. A high-frequency synthetic background verifies reduced aliasing while its vessel-core pixels and other linked views remain identical.

The installed vtk.js 37 CPR shader converts model indices to texture coordinates using `ijk/dim`, while voxel texture centres require `(ijk+0.5)/dim`. At the GPU boundary only, the supplied polyline and curved reference point are translated by half the sum of the affine's three spatial columns. This compensates the shader convention. The native image affine, source points, CPU sampling and navigation are not changed. Mask actors use the mapper's supported opaque pass with scalar alpha, preserving visibility and blending of zero-background labels.

Cross-sections use a **200 × 200 display sampling grid at 0.125 mm** over the original 25 mm FOV. CT remains trilinearly sampled from the native voxel data; this increases display sampling density, not acquired spatial resolution. Binary lumen/CPE samples are still retained with nearest-neighbour interpolation for scientific checks. The separate continuous display field samples the lumen trilinearly and, when Smooth edges is enabled, the Gaussian CPE display field; marching squares extracts its 0.5 isocontour. Antialiased vector paths replace painted pixel-edge borders and use even-odd filling to retain the lumen hole and separate components. Exact diagonal saddle ties keep foreground components separate. Local quadratic corner rounding is limited by one contour sampling interval; no global spline, circle fitting, source-mask overwrite, resegmentation or analytical measurement changes are introduced. These contours are display derivatives, comparable to the existing marching-cubes display surfaces, not new scientific labelmaps.

The cross-section is composited at 1024 × 1024 with approximately 1.5 CSS-pixel contour strokes. The 5 mm bar uses the actual display spacing. The optional 3D plane uses the same finer CT samples, fixed transported frame and matching physical pixel-centre extent. Axial labels retain the existing native raster display.

Both right-hand views support mouse-wheel navigation and left-button vertical dragging (4 CSS pixels per slice). Down advances and up reverses. The orthogonal view steps along the selected vessel centerline; the axial view steps through every native CT k slice, including slices outside the vessel extent. Axial navigation selects the nearest centerline point to the previous point projected onto the new native plane; outside the available centerline the vessel marker stays at the nearest available point. Navigating from the CPR, cross-section or 3D vessel clears the axial override and returns to the native slice through the selected point. A stationary axial click still selects the closest vessel point; dragging does not trigger that selection. Focus either slice and use Up/Down, Page Up/Down or Home/End for keyboard navigation. The former toolbar distance slider is removed.

The axial crosshair has red horizontal and green vertical arms, a central gap, and reference ticks. Its intersection retains the selected point's continuous native i/j coordinates. The displayed slice number is one-based. Both 2D views show orientation labels and an LPS cube projected from their actual image-plane axes. The 3D cube follows the camera; L/R are red, P/A green and S/I blue. Orthogonal orientation remains independent of both CPR rotations. Cubes and the axial crosshair are also included in PNG export. The backend preserves the original native matrix and bit masks; the axial endpoint is read-only and rejects indices outside the volume.

The orthogonal **Lumen Øeq** reference is `2 × sqrt(area / π)`, calculated from the unsmoothed, nearest-neighbour lumen component containing (or within 0.5 mm of) the selected centerline point. Area uses the actual cross-section grid spacing. Disconnected neighbouring lumens are excluded. Missing or FOV-clipped components display a dash. This is an area-equivalent diameter, not a minimum diameter or a stenosis estimate; smooth display contours, layer visibility, windowing and CPR rotation do not change it.

vtk.js **37.4.1** provides the GPU straightened and curved renderers. See [ImageCPRMapper documentation](https://kitware.github.io/vtk-js/api/Rendering_Core_ImageCPRMapper.html). CT, feature scalars and binary masks retain separate interpolation policies. The 3D texture uses the same cross-section samples, fixed transported frame and physical coordinates. The lime ring is a navigation marker. CPE colors can be customized; visibility and opacity changes are synchronized. vtk actors, textures, observers and render resources are disposed on unmount.

CPEs are predefined lumen-excluded radiomic sampling regions. They are not segmented fat, plaque, inflammation or voxelwise disease attribution. Supplied voxelwise radiomic features are displayed as input data; the AI panel separately computes patient-level Cox inference from recorded scalar features. No voxelwise PRI risk predictions, chamber modes, patient database service, cloud deployment, annotation editing or reporting are included.

## Verification

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
npm run build
# With the dev servers running:
npx playwright test
# Or against the built frontend served by the backend:
CORONARY_TEST_URL=http://127.0.0.1:8000 npx playwright test
```

On macOS, browser tests use an isolated headless Google Chrome at `/Applications/Google Chrome.app`. On Linux, install Playwright Chromium with `npx playwright install chromium`. The browser tests exercise real case loading, GPU CPR drag rotation, all vessel selections, longitudinal navigation, linked axial and orthogonal slices, layer visibility, windowing, reset and PNG export, and reject browser and GPU console errors. HTTP checks reject unknown patients, unlisted assets and writes. Geometry tests cover oblique affines, RAS/LPS conversion, voxel-centre conventions, interpolation, frame continuity, actual source alignment, mask exclusion, cached CT samples against direct source sampling, native crop affine/order/value preservation, full-rotation CPR crop coverage, matched rendered CPR heights, and subpixel contour/component/hole preservation.

Feature checks additionally compare every prepared map against its original NIfTI values and native axial placement, verify explicit support/zero/nonfinite handling and grid rejection, and exercise vessel-dependent selection, the palette, opacity, independent rotation with a map active, restoration of the CPE display, and PNG export.

A separate synthetic bowed tube of known 4 mm diameter tests the actual GPU rendering at eight rotation angles. At its axial midpoint, every sampling direction intersects the same circular diameter. Browser screenshots are decoded to measure the bright vessel width, checking physical scale, agreement with the straightened view, and diameter stability to within two raster pixels. This catches magnification changes independently of patient anatomy and of the camera's reported scale.

Screenshot output is under `test-results/`. **Export** downloads a PNG combining all five views, position markers, vessel, distance, both rotation angles, window values, and the selected feature name/range when active. `cache/`, screenshots, environments and dependencies are ignored by git.

Display validation also checks native crop sizes, Gaussian speck suppression with lumen-hole preservation, mesh normals/displacement/volume stability, support-normalized interpolation with missing neighbours, balanced/raw palette semantics, aorta visibility, mesh/edge toggles and independent CPE-mask visibility.

A patient-specific on/off audit at standard and Retina pixel densities confirms that the antialiasing toggle is active but often visually subtle. At device scale 2, case-1718 LAD changes about 0.54% of straightened pixels and RCA about 2.94%, with mean maximum-channel differences of 0.0066 and 0.0351 byte levels respectively (W 800 / L 250, straightened angle 6°, default viewport). These are display comparisons, not clinical noise-reduction measurements. Central-column pixels and the curved/orthogonal views are identical. The control is labelled Pixel antialiasing to distinguish it from background denoising or geometric correction.
