# Coronary / CPE viewer

Standalone browser viewer with a **patient browser**, one visible imaging case and up to three resident patient sessions. Patients **1, 8, 1718 and external P001** are registered and prepared. Five linked views: 3D coronary overview on the left; independently rotating straightened reconstruction and curved CPR in the center; orthogonal cross-section above native axial CCTA on the right. Vessel-specific radiomic feature maps can overlay the CCTA. All source medical data and the CoroCTAiomics pipeline are read-only. Generated files stay here.

## Local startup

Use Python **3.9+**, Node **20.19+ / 22.12+**, and a WebGL2 browser. The external drive must be mounted when inspecting or preparing the cache. The existing Python environment and node_modules have already been installed in this project.

From the parent `viewer/` directory:

```sh
cd coronary_viewer
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
./prepare.sh
npm run build
.venv/bin/python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000 --no-access-log
```

Open **http://127.0.0.1:8000/** to select a patient. Direct links such as **http://127.0.0.1:8000/viewer/1718** work on refresh. Build the frontend before starting this single-server mode. The backend serves only catalogue-registered generated case assets and the built frontend; it does not expose arbitrary source paths, accept file uploads, or modify data.

For frontend development, run the backend in one terminal and `npm run dev` in another. Open **http://127.0.0.1:5173/**; Vite proxies `/api` to the backend. Bind to loopback as shown.

The first page load shows a horizontal 0–100% indicator. Metadata completes the first 2%; decoded bytes for all 3D meshes, all three vessels' native masks/display fields and the single shared native CT/packed-label stack account for the next 96%. Expected sizes come from geometry, so gzip transfer sizes do not cause percentage overshoot. Download streams copy directly into their final buffers. The final 2% completes after all initial views are ready and two animation frames have passed; 100% remains briefly visible before the overlay fades. Controls are inert until startup completes. All vessel data are ready before the controls become active. A feature map loads on its first selection, then remains cached for the current case. Failed startup requests expose the normal error/Reload control instead of falsely reaching 100%.

## Patients: one registry, one command

**Edit only `config/viewer.local.json` to choose which patients appear.** Its
`patients` array is the allowlist; a cached folder or an eCRF row alone never
exposes another patient. Existing patients 1718, 1, 8 and P001 have been migrated.

For an internal patient, add one entry:

```json
{"id": "96", "ct": "/path/to/96.nii.gz", "output": "/path/to/pipeline/output/96"}
```

For an external patient, the image and output can be anywhere. Add a clinical
JSON when you need to supply history or acquisition/model inputs yourself:

```json
{"id": "P001", "ct": "/somewhere/P001.nii.gz", "output": "/elsewhere/P001/output", "clinical": "patients/P001.json"}
```

Then run:

```sh
./prepare.sh          # All registered patients; unchanged images are reused
./prepare.sh 96       # Just this patient (multiple IDs also work)
./prepare.sh --check  # Check paths and AI inputs without generating images
```

Return to the patient list and click **Refresh** after adding a prepared case.
Hard-refresh the browser after replacing images or clinical inputs, so the
resident viewer/AI result is released. Adding patients or editing JSON needs no
frontend build. Restart the backend once after installing this code refactor.

The pipeline structure supplies the rest:

- `postprocessing/{id}_lumen_mask_post_{merged,left,right}.nii.gz`
- `periluminal_r4/{id}_{LAD,LCX,RCA}_periluminal.nii.gz`
- `labeling/{id}_{LAD,LCx,RCA}_*.csv` and matching `.mrk.json`
- Optional `cardiac_structures/asc_aorta_shell.nii.gz`
- Optional `radiomics_r4_iso/maps` and scalar `radiomics_r4_iso/{id}_radiomics.csv`

Unique centerlines are selected automatically. If there are several branches,
set only the ambiguous vessel in an optional `centerlines` object, e.g.
`"centerlines": {"LAD": "96_LAD_2.csv"}`. Branch anatomy is never guessed.
Legacy map locations can use `"maps": "/path/to/maps"`; scalar CSVs can use
`"radiomicsCsv": "/path/to/file.csv"`. Most standard outputs need neither.
All relative paths resolve from the registry's directory, including clinical
JSON paths. `--config /path/to/viewer.json` selects an alternative registry.

The registry's `pipelineRoot`, `clinicalSources` and `ai` sections are one-time
setup. **They do not need editing for each patient.** Full eCRF CSVs provide
patient inputs; the fixed model-reference subsets define cohort comparisons.
The original PRI reference distribution lives in `resources/ai/`, not among
patient configuration files. Model/preprocessing exports live in `cache/ai/`.
There are no separate case files, catalogue file or AI config to maintain.

### Clinical information and manual overrides

Internal patients are matched by Patient ID in the full derivation/validation
eCRFs configured under `clinicalSources` (`df_der_no_hf.csv` / `df_cpc_no_hf.csv`).
Only reporting fields and model predictors are read; TIME/EVENT never enter
patient responses or predictions. CSVs are cached in memory and reread if they
change. An already exported cohort record remains available if storage is offline.

For an external patient, copy **`config/patients/_template.json`**, change its
`patientId`, enter recorded values, and reference it with `clinical` in the
registry. Use `Man`/`Woman`, `Yes`/`No`, numeric kVp/RF-CL/calcium values, and
recorded CAD-RADS/SS45. `null` means unknown; confirmed absence of chest pain is
`"Type of chest pain ": "No chest pain"`. RF-CL and SS45 are not inferred from
other fields by this loader. Missing model inputs make the affected prediction
unavailable while imaging remains usable.

The same `clinical` JSON can override an internal patient's eCRF record: include
**only the fields to replace**. Omitted keys retain eCRF values; explicit null
clears a value. Patient IDs must match. External scalar feature values are read
from the output's radiomics CSV; voxelwise maps do not replace scalar predictors.
The eight model feature columns can also be supplied explicitly in a manual JSON.

Clinical edits do not invalidate CT/mesh caches or refit models. Adding an
external patient never changes reference distributions, thresholds or percentiles.
Source data, CSVs, masks and upstream pipeline files remain read-only; generated
images stay under `cache/{id}`. Source descriptors permit a prepared viewer to
open with source storage disconnected. Replacing images requires preparation.

### Radiomic feature maps

The optional `maps` configuration key points to a directory containing vessel subdirectories `LAD`, `LCx`, and `RCA`. `LM-LAD` is accepted as an alias for `LAD`; having both is rejected as ambiguous. Each directory's `.nii.gz` files appear only for that vessel, using their original feature names. macOS `._` resource forks are ignored. Case 1718 has three LAD, two LCx and three RCA maps. A flat pipeline map folder is also supported: `{patientId}_{LAD|LCX|RCA}_{feature}.nii.gz`. The case prefix is checked and removed from display names; mixed patient IDs, mixed flat/folder layouts and duplicate maps fail explicitly. P001 uses this layout with 3 LAD, 4 LCx and 4 RCA maps, without reorganizing its source files.

After changing this directory or its files, run preparation and reload the browser. Preparation fingerprints every discovered map and requires its shape and physical affine to match the CCTA. A mismatched map fails explicitly rather than guessing registration. Display derivatives keep native voxel spacing and crop only the bounding box around the authoritative vessel CPE. Values are stored as Float32; original NIfTI files remain untouched. Per-feature 2nd/50th/98th percentiles are calculated from finite CPE voxels for the optional display stretch. Support is the corresponding `periluminal_r4` CPE intersected with finite feature values. Zero is valid, including zero-valued CPE voxels; NaN/Inf and voxels outside the CPE are transparent. The manifest records in-CPE extrema, zero/invalid counts, and nonzero values outside the CPE within the crop. Some supplied case-1718 maps have nonzero values outside the current CPE, so explicit clipping is necessary.

Use **Show radiomic maps** in the second toolbar row to reveal the vessel-specific feature selector and display the first available map. Toggle it off to hide maps while retaining the selected feature. Vessel selection, map selection and the color scale share that row. Selection is remembered separately for each vessel. Each map is fetched once when first selected and retained for the current case, including its VTK images; returning to that map or vessel restores it without another download or a map-loading placeholder. Concurrent requests for the same map share one promise, and closing the case aborts pending requests and releases cached resources. The radiomic maps use the 1024-color `sunset_risk` palette: `#63A78E`, `#8FA986`, `#EFEAD7`, `#DFC48D`, `#E9A06A`, `#E26756`, `#C51F36` at positions 0, 0.16, 0.35, 0.50, 0.67, 0.83 and 1. Low values are teal, the midpoint is muted gold, and high values are crimson. The legend uses the same positions.

**Derivation reference** is the default when a matching cohort lookup is available. The shared teal-to-crimson scale represents the local feature's percentile among the reference patients, giving the same feature value the same color across patients. The legend reads P0 / P50 / P100. The scale selector and reference-patient count are hidden. Scalar interpolation happens before percentile lookup in both CPRs and both linked slices. Exact lookup knots use weighted midranks; between retained knots, the CDF is interpolated. Values below/above the reference range saturate at P0/P100. These are feature percentiles, not voxel-wise MACE probabilities.

The cluster export lives at `config/radiomic-cohort-reference.local.json`. Replace it as the reference cohort grows, then refresh the viewer; no image preparation is needed. The backend attaches only compact display lookups to matching feature maps, without exposing cluster source paths. The local reference file is ignored by Git and must be included separately when transferring the demo. Without a matching reference, the map uses Balanced with numerical legend labels.

**Balanced** remains available as a patient-specific display scale: each feature's 2nd percentile maps to teal, its median to muted gold, and its 98th percentile to crimson. Separate linear stretches below/above the median give both halves of the distribution visible contrast; extrema beyond the percentile endpoints are saturated for display only. The three legend labels are actual feature values, including the gold median. Teal means lower relative values in this mode, and does not imply negative values. Ties, zero padding within the CPE and constant maps can prevent perfectly equal color counts. **Raw zero** preserves the original sign interpretation and symmetric `[-M, +M]` range, with `M = max(abs(min), abs(max))` (1 for an all-zero map). Zero is muted gold in Raw zero; a positive-only feature uses the gold-to-crimson half. No source values, features, inference or analytical masks are changed. Scale statistics remain fixed during navigation and rotation.

The selected feature overlays both CPRs, the fixed orthogonal slice, native axial CCTA, and the optional 3D cross-sectional plane. Feature scalars are interpolated before color mapping: trilinearly in the CPR and orthogonal plane, bilinearly during axial display enlargement. Interpolation is normalized by finite CPE support, so masked-out background and NaN neighbours do not dilute boundary values toward zero. CPU and GPU share the same scale parameters and colormap. The GPU stores scalar/support channels, divides by interpolated support, and applies its color transfer function afterward. A small OpenGL CPR view-node extension supplies the final color stage and rebuilds it when scale parameters change; vtk.js 37.4.1’s CPR renderer does not apply the generic shader-replacement hook. Its native coordinate/orientation/sampling stages are retained. Original finite zeros remain valid. The 3D vessel surfaces retain territory colors.

**Gear menu → CPE masks** independently toggles all binary CPE display surfaces, fills and contours, preserving vessel-specific selections in the gear menu. Feature maps remain visible when masks are hidden. **Gear menu → Map opacity** adjusts the map independently. Rotation resamples the map while orthogonal/axial orientation remains fixed. The color-scale legend shows the feature name and numeric anchors.

**Gear menu → Smooth edges** controls a separate boundary display derivative, enabled by default. A physical Gaussian kernel with sigma 0.35 mm produces a continuous CPE field; its 0.5 contour, antialiased coverage and rounded vector paths replace voxel steps and suppress thin spurs/small specks. The map is clipped to the same display field. Smoothing can hide small source-mask fragments or shift the displayed edge; disable Smooth edges to inspect the original voxel support. Binary sampling and source NIfTI labels stay unchanged. Display fields are generated independently in each native vessel crop, with halo padding in feature crops.

The optional ascending aorta is discovered at `outputRoot/cardiac_structures/asc_aorta_shell.nii.gz`. An explicit `ascendingAorta` path can override it; a missing explicit path fails preparation. Its own NIfTI affine maps the surface to physical LPS. The gear menu provides Ascending aorta visibility and opacity; it is included in the 3D camera fit. Existing cases without this optional file still load.

### Interaction

- Drag horizontally in **Curved CPR** to rotate around the vessel's longitudinal axis. Each central reconstruction has an independent rotation angle. Rotation in one panel does not rotate the other, the orthogonal cross-section, its 3D plane, or axial CCTA. All views continue to share the selected vessel and longitudinal position.
- Drag horizontally in **Straightened** to rotate its plane around the transported local tangent; click or drag vertically to select a longitudinal position. Gesture direction locks after a small movement threshold, so starting a rotation does not move the selected slice. Click a row in Curved CPR or scroll either reconstruction to navigate. All five views follow the same centerline sample.
- The curved panel uses vtk.js stretched CPR: the vessel retains lateral curvature, and longitudinal display distance is projected perpendicular to its current sampling direction. Its marker uses these projected distances, not a guessed image fraction.
- Select LAD, LCx or RCA in the toolbar or click a vessel in 3D. Clicking axial CCTA selects the nearest centerline sample in physical space.
- The **gear icon** at the far right opens layer visibility, opacity, colors, the optional 3D plane and **W/L** controls for the shared CT window. **Reset** restores the camera and zero rotation in both central views. The former Layers text button and Export button are removed.

The imaging workspace keeps its minimal toolbar, panel names, rotation angle, orientation letters and scale references. **Show AI report**, right-aligned beside the gear menu, opens a compact nonmodal results panel over the lower-left view. Opening it preserves the size, camera and current position of all five views. Close with ×, the AI button or Escape; tab navigation supports arrow keys. Scientific interpretation and implementation details are documented here.

### CPE volume rendering

The 3D panel opens in **anatomy** mode with ascending aorta and lumen, while CPE masks and radiomic maps start hidden. **Show periluminal envelopes** toggles both the CPE volume rendering and the binary masks in the linked image panels. Enabling it uses Balanced transfer functions and Unlit lighting to ray-cast native CCTA voxels within the union of the saved CPE masks. It does not generate tissue segmentations or alter source images. Native CT and labels are already resident, so the first toggle needs no additional imaging download. Its cancellable volume packing runs on demand with an inline status; it never restarts the initial loader. Toggling off returns to anatomy and hides the masks, retaining prepared rendering resources for reuse. Radiomic maps have a separate toggle. Up to three loaded patient sessions remain resident as described below.

**Settings** keeps only overall density, the four HU-band opacity gains and anatomical context opacity. Defaults match the supplied reference: density **0.9**, Fat range **1.05**, Low HU **2**, Intermediate **0**, High HU **2**, context **0.5**. The Anatomy selector, preset/lighting selectors and Cut at section control are removed from the interface. Alternative presets, lighting modes and anatomical rendering remain available internally; cutaway clipping is removed. The rendering uses multi-reference calibration, described below; legend tooltips show patient-specific native HU intervals. The attenuation transfer functions have short continuous transitions between bands. They are independent of the CCTA window/level and the green–pink radiomic colormap. The legend's hover text gives the ranges. These are illustrative display bands, **not validated plaque composition, histology, fat classification or inflammation labels**. Contrast, kVp and partial volume influence attenuation; high HU can include contrast contamination as well as calcium. Only material actually present in the CPE can be shown. See the [SCCT quantitative CCTA consensus](https://pubmed.ncbi.nlm.nih.gov/38849237/).

The native CT is packed as two Float32 channels: **HU × support** and **support**. Mask support is derived from finite CT and the original CPE bits, explicitly excluding the lumen. Trilinearly sampled HU is reconstructed by dividing by interpolated support *before* color/opacity lookup; coverage then scales optical depth rather than acting as a second material. Thus transparent background and voxels in another hidden territory cannot dilute boundary HU, create artificial low-attenuation rims or bleed dense structures into the rendered region. The original native CT and labels are untouched. Per-vessel CPE checkboxes in the gear menu select included territories; their union avoids double-counting overlapping CPEs. The **CPE masks** control inside the gear menu can also adjust binary surfaces/2D fills independently of the CT volume. In volume mode, the colored CPE surface shells are suppressed and lumen/aorta/centerlines use the context-opacity multiplier. The existing anatomical renderer remains the internal fallback if no finite CPE voxels are available, with an inline retry message.

Cinematic lighting uses vtk.js composite ray casting with a warm key/cool fill, volumetric scattering and mask-aware shadow rays; Surface/AO uses local ambient occlusion, and Unlit exposes the attenuation colors without illumination. This is an interactive **cinematic-style approximation**, not Siemens' Monte Carlo path tracer. A small vtk.js 37.4.1 OpenGL factory extension fixes the stock multicomponent shadow/AO lookups to respect CPE support and the appropriate transfer-function rows, and skips empty samples. No voxels outside CPE cast volume shadows. Quality is reduced during interaction and returns to full resolution when stationary. The render-engine capture helpers remain internal; there is no Export control in the viewer.

Native CT sampling is retained without spatial downsampling; for case 1718 the crop adds approximately 85 MiB of CPU arrays plus its GPU texture while retained. Source voxel noise and the finite spatial resolution remain visible, and excluded plaque cannot be recovered by rendering.

Validation includes native HU/oblique geometry/source-immutability checks, cancellable preparation, a rendered four-material phantom with a bright masked-out background, territory hiding/restoration including an all-zero mask, compact volume/gear menus, W/L changes, inline empty-mask recovery, and real cases 1718/8. The phantom verifies colors and transparency numerically, rather than merely checking that a volume actor exists.

### AI patient summary

The AI panel shows the configured patient's **PRI-only** and **adjusted** 4-year MACE probabilities and the **Risk category** derived from the PRI-only model. Patient, Features and Cohort tabs keep secondary information separate from the persistent predictions. Results load only on first opening; reopening the panel uses the resident result. AI errors/retry stay inside this panel and do not interrupt imaging. The AI report fills the left 3D region; the four linked image views remain interactive. Closing the report restores the cached 3D scene without reloading images.

- **Patient:** recorded age, sex, ESC RF-CL percentage/class, full CAD-RADS, Agatston score, smoking, hypertension, diabetes, dyslipidemia, dyspnea, chest-pain presentation, CAD family history and BMI. The stored likelihood/class are displayed without recalculation. Unknown, absent and explicitly unspecified information is preserved; none is interpreted as a negative finding. Family history is not a separate Cox predictor; it contributes to RF-CL when that value is calculated from its components. The other report-only fields do not enter the models. The adjusted model uses the original continuous `Clinical Likelihood` and binary `SS45`, which is a separate field from full CAD-RADS.
- **Features:** all eight native patient-level radiomic values, grouped by vessel, alongside their derivation-cohort median, interquartile range (P25–P75) and empirical patient percentile. This tab stays within the left region, adapting feature-name wrapping and compact value/reference rows to the available width. Its toolbar contains only the Model selector; the derivation count stays in the Cohort tab. References use finite native values from derivation patients only, before harmonization/scaling; validation patients never enter these distributions. Display values use four significant digits (IQR limits use three); hover preserves the full precision. HRs follow the chosen PRI-only/adjusted model; directional arrows are omitted. A † marks 95% intervals including 1; hover or focus an HR for its full interval and interpretation. These HRs are per training SD after preprocessing, conditional on the other model predictors, not local voxel risk. Clicking a feature selects its available vessel/map in the viewer. Map colors retain their existing numerical meaning.
- **Cohort:** derivation patient/event counts, median age and percentage of women, plus patient-versus-median comparisons and empirical percentiles for PRI-only risk, age, Agatston and RF-CL. PRI uses the original out-of-fold derivation risks. Percentiles exclude missing values and use midrank for ties. Calcium-score availability is shown explicitly.

The PRI bar has **25% / 50% / 25%** segments and the study's right-closed boundaries: Low ≤ Q25, Intermediate Q25 < risk ≤ Q75, High > Q75. Thresholds are read from the saved **out-of-fold derivation** configuration (currently 6.4473% and 10.5730% at 48 months), cross-checked against the PRI bundle. Hover a band/tick to see the threshold. The optional `priOofReference` JSON supplies the original out-of-fold PRI-only risk distribution. Its model, horizon, patient count and quartiles must match the derivation cohort and study thresholds before export. When available, the empirical percentile appears in a dedicated Percentile column between Adjusted and Risk category (e.g. 83.9 for P001), positions the white marker on the bar, and appears in the Cohort comparison table. The calculation is `100 * (number below + 0.5 * number tied) / reference count`, using the full-precision patient risk. External/validation cases never enter this distribution. Without this reference, the percentile is unavailable and the marker remains centered in the assigned category; no percentile is inferred from thresholds or in-sample refitted risks. The feature/age/calcium/RF-CL percentiles are actual empirical values. Feature percentiles are descriptive positions in the native-value derivation distribution, not risk percentiles or preprocessing-adjusted contributions. Cox HR interpretation follows the [lifelines survival-regression documentation](https://lifelines.readthedocs.io/en/latest/Survival%20Regression.html#interpretation).

### Fixed AI model/reference preparation

The `ai` section in `viewer.local.json` contains the original model bundles,
MEDIS reference-cohort subsets, study thresholds and OOF reference path. These
are distinct from the **full** clinical eCRFs used to look up patients. The
original reference cohort remains 1,038 derivation patients. Adding a patient or
applying clinical overrides never changes that reference population.

`prepare.sh` automatically runs the one-time numerical export when its sources
or settings change, using `.venv-ai/bin/python` (or `CORONARY_ANALYSIS_PYTHON`).
This analysis environment needs `requirements-ai.txt`; the imaging/HTTP runtime
uses `.venv` and `requirements.txt`. Trusted pickle bundles are read only during
export. The running viewer uses the validated numerical export in `cache/ai/`.
To rerun just that step:

```sh
.venv-ai/bin/python -m backend.export_ai
```

The exporter verifies site-only ComBat, saved scaling and Cox inference against
the original lifelines/neuroHarmonize calculation. The OOF distribution's model,
horizon, count and quartiles must match the study thresholds. Outcome-dependent
imputation is not used; missing radiomic/kVp/RF-CL/SS45 inputs disable the relevant
prediction. No model is retrained. AI setup and patient clinical edits are excluded
from imaging fingerprints.

P001 retains its recorded clinical JSON and source scalar CSV. Its prediction,
reference percentiles and feature references were checked unchanged during this
migration. The existing image caches were reused only after verifying identical
source paths and their pre-migration fingerprints. No source image or mask was
modified. Alternate legacy config environment variables remain available solely
for existing scripts; normal operation uses `CORONARY_VIEWER_CONFIG` or
`prepare.sh --config`.

### Component-based clinical likelihood

`backend.rf_cl.calculate_pretest(components, clinical_data=None, *, chest_pain_absent=False, symptom_score=None)` takes one patient dictionary and returns a new dictionary, without saving or modifying the input. The optional array has the original `[age, risk-factor band, sex, symptom band]` axes and shape `(5, 3, 2, 3)`. The default is a read-only numerical copy of all 90 cells in the original study's `clinical_data.pkl`; no runtime pickle or source-drive access is needed.

The function recounts **hypertension, dyslipidemia, current/former smoking, diabetes and premature CAD family history**. It ignores a previously supplied `Number of risk factors`. Unknown factors stay unknown: the exact count is null, with a known-positive count and possible total range. A percentage is returned only if every possible count selects the same numerical lookup value; an ambiguous value raises an explicit error. An unknown symptom never becomes absent automatically. Confirm absence with `chest_pain_absent=True`, `Chest Pain: No`, or the explicit `Type of chest pain : No chest pain` value. The misspelling `Dyslipdemia` is accepted as an input alias and normalized to `Dyslipidemia`; conflicting aliases fail. Ages outside the published 30–80-year table fail rather than silently extrapolating.

```python
from backend.rf_cl import calculate_pretest

result = calculate_pretest(components, chest_pain_absent=True)
# result is JSON-compatible for JSON-compatible component inputs.
```

For the supplied 42-year-old man with dyslipidemia and smoking, no hypertension/diabetes/dyspnea, confirmed absence of chest pain and unknown family history, the total risk-factor count is **2–3**, the lookup group is **2–3**, and clinical likelihood is **4% (Very low)**. CAD-RADS `Score 2` gives `SS45: No` according to the study's existing CAD-RADS 4/5 definition. CAD-RADS does not enter the RF-CL lookup itself. Patient JSON remains manually editable; the viewer does not silently recalculate or replace stored RF-CL values.

**Symptom-coding provenance:** the default preserves the pasted cohort function exactly: atypical pain = 1, typical = 2, rest pain = 3, plus 2 for dyspnea, capped at 3. This is not the symptom definition in [ESC 2024 Figure 4](https://doi.org/10.1093/eurheartj/ehae177), where chest-pain characteristics generate a 0–3 score and exertional dyspnea is an alternative 2-point presentation. Pass an independently assessed `symptom_score=0/1/2/3` to select that score explicitly; the returned `RF-CL symptom coding` records the choice. Existing cohort predictors and fitted models remain unchanged. The refactor was cross-checked against the original dataframe function in 480 complete-input combinations spanning all lookup cells and cohort symptom combinations.

## Inspection findings

`python -m backend.inspect_case` inspects the default case; `--case {patientId}` inspects a catalogue case. Reports with image headers, geometry, alignment diagnostics and VTP metadata are written to `cache/{patientId}/inspection.json`. The legacy `cache/inspection.json` describes only the default case; preparing/inspecting another patient does not overwrite it. The following table records the original case-1 inspection:

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

**Gear menu → Pixel antialiasing** enables adaptive pixel-footprint filtering of the straightened CCTA, on by default. The fragment shader estimates native-voxel footprint using screen derivatives of the 3D sampling coordinates before the volume-bounds branch. It integrates 1–16 trilinear CT samples along the dominant footprint direction before windowing. Pixels spanning no more than one native voxel retain the original single sample. This is a display prefilter, not a through-plane MIP/AVG slab; the centerline, transported frames, coordinates, source CT, masks, feature values, curved CPR and orthogonal/axial slices are unchanged. Broad geometric distortion remains; antialiasing reduces fine undersampling artifacts rather than reconstructing undistorted distant anatomy. The toggle restores the unfiltered rendering for comparison. A high-frequency synthetic background verifies reduced aliasing while its vessel-core pixels and other linked views remain identical.

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

On macOS, browser tests use an isolated headless Google Chrome at `/Applications/Google Chrome.app`. On Linux, install Playwright Chromium with `npx playwright install chromium`. The browser tests exercise real case loading, GPU CPR drag rotation, all vessel selections, longitudinal navigation, linked axial and orthogonal slices, layer visibility, windowing and reset, and reject browser and GPU console errors. HTTP checks reject unknown patients, unlisted assets and writes. Geometry tests cover oblique affines, RAS/LPS conversion, voxel-centre conventions, interpolation, frame continuity, actual source alignment, mask exclusion, cached CT samples against direct source sampling, native crop affine/order/value preservation, full-rotation CPR crop coverage, matched rendered CPR heights, and subpixel contour/component/hole preservation.

Feature checks additionally compare every prepared map against its original NIfTI values and native axial placement, verify explicit support/zero/nonfinite handling and grid rejection, and exercise vessel-dependent selection, the palette, opacity, independent rotation with a map active, restoration of the CPE display, and PNG export.

A separate synthetic bowed tube of known 4 mm diameter tests the actual GPU rendering at eight rotation angles. At its axial midpoint, every sampling direction intersects the same circular diameter. Browser screenshots are decoded to measure the bright vessel width, checking physical scale, agreement with the straightened view, and diameter stability to within two raster pixels. This catches magnification changes independently of patient anatomy and of the camera's reported scale.

Screenshot output is under `test-results/`. The viewer has no Export button. `cache/`, screenshots, environments and dependencies are ignored by git.

Display validation also checks native crop sizes, Gaussian speck suppression with lumen-hole preservation, mesh normals/displacement/volume stability, support-normalized interpolation with missing neighbours, balanced/raw palette semantics, aorta visibility, mesh/edge toggles and independent CPE-mask visibility.

A patient-specific on/off audit at standard and Retina pixel densities confirms that the antialiasing toggle is active but often visually subtle. At device scale 2, case-1718 LAD changes about 0.54% of straightened pixels and RCA about 2.94%, with mean maximum-channel differences of 0.0066 and 0.0351 byte levels respectively (W 800 / L 250, straightened angle 6°, default viewport). These are display comparisons, not clinical noise-reduction measurements. Central-column pixels and the curved/orthogonal views are identical. The control is labelled Pixel antialiasing to distinguish it from background denoising or geometric correction.

Right-click and drag in either CPR, the orthogonal cross-section or the axial view to adjust shared CCTA window/level: right widens the window, left narrows it, up raises the level and down lowers it. Current W/L appears while dragging. Left-drag navigation/rotation and wheel scrolling keep their existing behaviour. The gear menu also exposes numeric W/L controls.

## Switching between three demonstration patients

The browser keeps the last **three fully loaded patient viewers** resident,
including CT/masks, downloaded radiomic maps, CPE volume buffers, vtk.js objects
and GPU textures. Returning to the patient list pauses that viewer rather than
unmounting it. The list reuses its last response; **Refresh** fetches an updated
catalogue. A green **Ready** label identifies a loaded case.

Before the demonstration, open each of the three cases once, let its loading
bar finish, then return to Patients. Subsequent visits in the **same browser
tab** reuse the complete session without imaging downloads or rebuilding the
CPE volume. Vessel selection, rotations, slice position, maps and optical
settings are preserved. Hidden renderers do not redraw on window resize or
receive input; returning resizes/redraws only the active viewer.

Opening a fourth patient releases the least recently visited viewer. Leaving
an unfinished case cancels its initial load instead of retaining partial data.
Reloading/closing the tab clears the resident sessions; after a reload they
must be opened once again. Reload the tab after changing case configuration or
prepared image data to avoid retaining an older in-memory version. Retaining
three full-resolution sessions uses substantially more RAM/GPU memory than
one, so warm the actual three cases on the demonstration PC before the session.

Native CT assets are transferred directly for loopback clients (127.0.0.1 and
::1), avoiding server compression and browser inflation. Sparse masks, meshes
and non-local responses still use fast gzip level 1. Native CT resolution, HU
and masks are unchanged; streaming byte-integrity checks cover both paths.
Restart the backend after updating this transfer policy. In fresh headless
Chrome sessions on the development Mac (software WebGL, patient 8), complete
initial opening measured 17.0 seconds with default gzip, 7.7 seconds with fast
gzip, and about 5.1 seconds with direct local CT transfer. These are local
comparative measurements, not a Windows-PC performance guarantee. CPE packing
and renderer-setup timings are available in the 3D scene DOM data attributes
volume-pack-ms and volume-setup-ms for further profiling.

**Context**, **Aorta opacity** and **Lumen opacity** share one 3D anatomy
opacity, initially **50%**. Both aorta and lumen use it directly in anatomy
and CPE volume modes, so switching modes preserves the same opacity without
an extra multiplier. Lumen contours in the linked image views retain their
independent display opacity.


### Experimental multi-reference rendering

CPE cinematic rendering uses **Multi-reference** exclusively. Fixed-HU and
blood-only rendering modes are not offered. Prepared fat, myocardium and aortic
blood references map color/opacity knots to each patient's native HU distribution.
If references are unavailable, anatomy remains visible with an explanatory
message; the viewer does not silently use fixed thresholds. This is a custom
experimental visualization, not a validated tissue or plaque classifier.

Fat references use native CPE voxels between −190 and −30 HU, excluding the
segmented lumen. Myocardium is sampled across up to 31 slices, more than 2 mm
inside its in-plane mask boundary and 3 mm away from segment ends. Aortic blood
uses 3-mm-radius central ROIs across up to 31 slices in the central half of the
ascending-aorta shell, with at least 6 mm centre clearance. The high-HU display
boundary is max(350 HU, aortic P99). Missing, insufficient or unordered references
prevent cinematic volume rendering; anatomical and linked CT views still work.

**Blood/muscle fade** defaults to 80%. It reduces opacity where HU resembles
blood or myocardium: full affinity between P10/P90, tapering to zero at P1/P99.
Fat-range HU ≤ −30 are protected. At zero fade, calibrated colors remain without
this suppression. Plaque with overlapping intensities can also fade; these colors
do not identify veins, calcium, inflammation or histology.

`./prepare.sh` adds cached reference metadata without rebuilding unchanged images.
For a single already-prepared patient:

```sh
.venv/bin/python -m backend.tissue_reference --case 814
```

The original CT, masks, radiomic maps and PRI inputs remain unchanged. No extra
volume downloads are required; fade changes update only transfer functions.
Hard-refresh after updating reference metadata. Context, Aorta opacity and Lumen
opacity remain linked across both 3D modes, starting at 50%.
