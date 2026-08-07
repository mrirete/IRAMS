// <img> for objects living in a private bucket (0235).
//
// Drop-in for `<img src={row.image} />` where the value is a stored
// `bucket/path` reference. Signing is async, so this owns the placeholder and
// error states rather than leaving every call site to invent its own.

import React from 'react';
import { useStorageUrl } from '../../../hooks/useStorageUrl';

interface StorageImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
    /** Stored reference: `bucket/path`, a legacy public URL, or a data URI. */
    value: string | null | undefined;
    /** Rendered while signing, and whenever the object cannot be resolved. */
    fallback?: React.ReactNode;
}

export const StorageImage: React.FC<StorageImageProps> = ({
    value,
    fallback = null,
    alt = '',
    ...imgProps
}) => {
    const { url, loading } = useStorageUrl(value);
    const [failed, setFailed] = React.useState(false);

    // A new value deserves a fresh attempt — otherwise one broken object
    // permanently poisons the slot as the user pages through records.
    React.useEffect(() => setFailed(false), [url]);

    if (!value || failed || (!url && !loading)) return <>{fallback}</>;
    if (loading || !url) {
        return <>{fallback}</>;
    }

    return <img src={url} alt={alt} onError={() => setFailed(true)} {...imgProps} />;
};

export default StorageImage;
