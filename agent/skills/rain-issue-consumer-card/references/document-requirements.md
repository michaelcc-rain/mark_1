# Document requirements — upload, types, and the 400 fastfail

Endpoint: `PUT /issuing/applications/user/{userId}/document` (operationId
`uploadIssuingUserApplicationDocument`). It is **PUT**, addressed by `userId`,
`multipart/form-data`. **Call it once per document.** Success is **`204`** (empty body).

## Multipart fields

| Field | Required | Type / constraint | Notes |
|---|---|---|---|
| `document` | **yes** | binary, `maxLength: 20971520` (20 MiB) | The file bytes. |
| `name` | no | string | Display name of the document. |
| `type` | no | enum (see below) | What kind of document this is. |
| `side` | no | `front` \| `back` | ID card / driver's license / residence permit only. **Omit for passport.** |
| `countryCode` | no | ISO `CountryCode` | Use **this** for the issuing country. |
| `country` | no | 3-char string | **`deprecated: true`** — use `countryCode` instead. |

### `type` enum (20 values, verbatim)

`idCard`, `passport`, `drivers`, `residencePermit`, `utilityBill`, `selfie`,
`videoSelfie`, `profileImage`, `idDocPhoto`, `agreement`, `contract`,
`driversTranslation`, `investorDoc`, `vehicleRegistrationCertificate`, `incomeSource`,
`paymentMethod`, `bankCard`, `covidVaccinationForm`, `other`.

## What KYC actually accepts

The endpoint *accepts* all 20 types, but for **Consumer KYC** only these are **approved**:

- **Identification** — exactly one of: Passport (`passport`), ID card (`idCard`),
  Driver's license (`drivers`), or Residence permit (`residencePermit`).
- **Selfie** (`selfie`).

"Other documents may be available for submission but will not be approved." So the
minimum viable KYC upload is two calls: one identification doc + one selfie.

### `side` rules

- **Passport:** leave `side` **empty** (single-page MRZ document).
- **ID card / driver's license / residence permit:** upload `front` and `back` as two
  separate calls, each with the matching `side`.

## The `400 "Document rejected"` fastfail

A bad document is rejected **synchronously** with `400` — before any human review. Two
shapes are documented; **parse both**, because Rain's own docs disagree on the shape:

**Authoritative (`DocumentUploadErrorResponse`):**

```json
{
  "statusCode": 400,
  "error": "BadRequestError",
  "message": "Document rejected: UNSATISFACTORY_PHOTOS, LOW_QUALITY",
  "errorMessageCodes": ["UNSATISFACTORY_PHOTOS", "LOW_QUALITY"]
}
```

**Prose-doc variant (no `errorMessageCodes`, different `error` + prefix):**

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Document rejected by Sumsub: forbiddenDocument, missingImportantInfo"
}
```

Robust handling:

1. Read `errorMessageCodes` if present (array of tags).
2. Otherwise split the `message` on the first `:` and parse the comma-separated tail.
3. Treat the tag set as **open-ended** — codes come in two casings (`UPPER_SNAKE` and
   `camelCase`) and both appear in Rain docs.

```ts
function parseDocReject(body: { message?: string; errorMessageCodes?: string[] }) {
  if (Array.isArray(body.errorMessageCodes) && body.errorMessageCodes.length)
    return body.errorMessageCodes;
  const tail = (body.message ?? '').split(/:(.+)/)[1] ?? '';
  return tail.split(',').map((t) => t.trim()).filter(Boolean);
}
```

### Error tags — block; upload a DIFFERENT document

`forbiddenDocument`, `differentDocTypeOrCountry`, `missingImportantInfo`,
`dataNotReadable`, `expiredDoc`, `documentWayTooMuchOutside`, `noIdDocFacePhoto`,
`selfieFaceBadQuality`, `screenRecapture`, `screenshot`, `sameSides`,
`shouldBeMrzDocument`, `shouldBeDoubleSided`, `shouldBeDoublePaged`,
`documentDeclinedBefore`, `mrzNotReadable`, `docExpiresSoon`, `missingDob`,
`incompleteDob`.

→ The user must supply a different/correct document. Don't re-upload the same file.

### Warning tags — allow proceeding after a retake

`badSelfie`, `dataReadability`, `inconsistentDocument`, `maybeExpiredDoc`,
`documentTooMuchOutside`.

→ A better capture of the same document type is fine.

## Consequence of a rejection on application status

A rejected document marks that document inactive and moves the application into a
re-submission state. Two docs disagree on which:

- `docs/application-states.mdx` → `needsInformation` ("Documents were rejected;
  resubmission needed").
- `docs/compliance-documentation.mdx` → `needsVerification`.

Treat **either** as "the user must resubmit." `needsInformation` is the one explicitly
described as a document-resubmission state, so key your messaging off that. See
[`application-states.md`](application-states.md) for what to do in each (redirect to
`applicationCompletionLink`).
