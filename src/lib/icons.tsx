/*
 * The icons this app draws, over @phosphor-icons/react — the same artwork
 * react-icons repackaged, at 31MB instead of 82. The Pi names are unchanged.
 */

import type { Icon, IconProps } from "@phosphor-icons/react";
import {
  ArrowBendUpLeft,
  ArrowCircleUp,
  ArrowDown,
  ArrowLineLeft,
  ArrowLineRight,
  ArrowsClockwise,
  ArrowsLeftRight,
  ArrowSquareOut,
  ArrowUp,
  At,
  Bell,
  BellSimple,
  Boot,
  Broadcast,
  Bug,
  Camera,
  CameraSlash,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  ChartBar,
  ChatsTeardrop,
  ChatTeardropDots,
  ChatTeardropText,
  Check,
  CheckCircle,
  Circle,
  Clock,
  ClockClockwise,
  CloudArrowDown,
  CloudArrowUp,
  Code,
  Copy,
  CopySimple,
  CornersIn,
  CornersOut,
  Desktop,
  DeviceMobile,
  Devices,
  DoorOpen,
  DotsSixVertical,
  DotsThree,
  DotsThreeCircle,
  DotsThreeVertical,
  DownloadSimple,
  Envelope,
  Eye,
  EyeSlash,
  FadersHorizontal,
  File,
  FileAudio,
  FilePlus,
  FileText,
  FileVideo,
  FileZip,
  Fingerprint,
  Flag,
  Flask,
  Folder,
  GameController,
  Gauge,
  Gear,
  GearSix,
  Gift,
  GlobeSimple,
  HandWaving,
  HardDrives,
  House,
  HouseLine,
  Image,
  Info,
  Key,
  Keyboard,
  Link,
  LinkSimple,
  List,
  ListChecks,
  LockOpen,
  LockSimple,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Microphone,
  MicrophoneSlash,
  Minus,
  MinusCircle,
  Monitor,
  MonitorArrowUp,
  Palette,
  PencilSimple,
  Phone,
  PhoneCall,
  PhoneDisconnect,
  PhoneX,
  Play,
  Plugs,
  Plus,
  Prohibit,
  Pulse,
  PushPin,
  PushPinSlash,
  PuzzlePiece,
  Robot,
  ScanSmiley,
  Screencast,
  ShieldCheck,
  ShieldSlash,
  ShieldWarning,
  SidebarSimple,
  SignIn,
  SignOut,
  Signpost,
  SlidersHorizontal,
  SmileyWink,
  SpeakerHigh,
  SpeakerSimpleHigh,
  SpeakerSimpleSlash,
  SpeakerSlash,
  SquaresFour,
  Stop,
  TrashSimple,
  UploadSimple,
  User,
  UserPlus,
  UsersThree,
  Warning,
  WarningCircle,
  WebhooksLogo,
  WifiSlash,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { useId } from "react";

/**
 * A phosphor icon fixed at one weight. Fixed rather than defaulted, because these
 * are passed around as values and a default only applies where props are spread.
 */
function weighted(Base: Icon, weight: IconProps["weight"], name: string): Icon {
  const Fixed = (props: IconProps) => <Base weight={weight} {...props} />;
  Fixed.displayName = name;
  return Fixed as Icon;
}

export const PiArrowBendUpLeftFill: Icon = weighted(ArrowBendUpLeft, "fill", "PiArrowBendUpLeftFill");
export const PiArrowBendUpLeftBold: Icon = weighted(ArrowBendUpLeft, "bold", "PiArrowBendUpLeftBold");
export const PiArrowDownBold: Icon = weighted(ArrowDown, "bold", "PiArrowDownBold");
export const PiArrowUpBold: Icon = weighted(ArrowUp, "bold", "PiArrowUpBold");
export const PiArrowLineLeftFill: Icon = weighted(ArrowLineLeft, "fill", "PiArrowLineLeftFill");
export const PiArrowLineRightFill: Icon = weighted(ArrowLineRight, "fill", "PiArrowLineRightFill");
export const PiArrowsClockwiseBold: Icon = weighted(ArrowsClockwise, "bold", "PiArrowsClockwiseBold");
export const PiArrowsClockwiseFill: Icon = weighted(ArrowsClockwise, "fill", "PiArrowsClockwiseFill");
export const PiArrowsLeftRightFill: Icon = weighted(ArrowsLeftRight, "fill", "PiArrowsLeftRightFill");
export const PiArrowSquareOutBold: Icon = weighted(ArrowSquareOut, "bold", "PiArrowSquareOutBold");
export const PiArrowSquareOutFill: Icon = weighted(ArrowSquareOut, "fill", "PiArrowSquareOutFill");
export const PiAtFill: Icon = weighted(At, "fill", "PiAtFill");
export const PiBellFill: Icon = weighted(Bell, "fill", "PiBellFill");
export const PiBootFill: Icon = weighted(Boot, "fill", "PiBootFill");
export const PiBroadcastFill: Icon = weighted(Broadcast, "fill", "PiBroadcastFill");
export const PiBugFill: Icon = weighted(Bug, "fill", "PiBugFill");
export const PiCameraFill: Icon = weighted(Camera, "fill", "PiCameraFill");
export const PiCaretDownFill: Icon = weighted(CaretDown, "fill", "PiCaretDownFill");
export const PiCaretLeftBold: Icon = weighted(CaretLeft, "bold", "PiCaretLeftBold");
export const PiCaretRightBold: Icon = weighted(CaretRight, "bold", "PiCaretRightBold");
export const PiCaretRightFill: Icon = weighted(CaretRight, "fill", "PiCaretRightFill");
export const PiCaretUpFill: Icon = weighted(CaretUp, "fill", "PiCaretUpFill");
export const PiChatTeardropDotsFill: Icon = weighted(ChatTeardropDots, "fill", "PiChatTeardropDotsFill");
export const PiChatTeardropTextFill: Icon = weighted(ChatTeardropText, "fill", "PiChatTeardropTextFill");
export const PiChatsTeardropFill: Icon = weighted(ChatsTeardrop, "fill", "PiChatsTeardropFill");
export const PiChartBarFill: Icon = weighted(ChartBar, "fill", "PiChartBarFill");
export const PiCheck: Icon = Check;
export const PiCheckBold: Icon = weighted(Check, "bold", "PiCheckBold");
export const PiCheckCircleFill: Icon = weighted(CheckCircle, "fill", "PiCheckCircleFill");
export const PiClockClockwiseFill: Icon = weighted(ClockClockwise, "fill", "PiClockClockwiseFill");
export const PiClockFill: Icon = weighted(Clock, "fill", "PiClockFill");
export const PiCircleFill: Icon = weighted(Circle, "fill", "PiCircleFill");
export const PiCloudArrowDownFill: Icon = weighted(CloudArrowDown, "fill", "PiCloudArrowDownFill");
export const PiCloudArrowUpFill: Icon = weighted(CloudArrowUp, "fill", "PiCloudArrowUpFill");
export const PiCode: Icon = Code;
export const PiCopyBold: Icon = weighted(Copy, "bold", "PiCopyBold");
export const PiCopyFill: Icon = weighted(Copy, "fill", "PiCopyFill");
export const PiCopySimple: Icon = CopySimple;
export const PiCopySimpleBold: Icon = weighted(CopySimple, "bold", "PiCopySimpleBold");
export const PiCornersInFill: Icon = weighted(CornersIn, "fill", "PiCornersInFill");
export const PiCornersOutFill: Icon = weighted(CornersOut, "fill", "PiCornersOutFill");
export const PiDesktopFill: Icon = weighted(Desktop, "fill", "PiDesktopFill");
export const PiDeviceMobileFill: Icon = weighted(DeviceMobile, "fill", "PiDeviceMobileFill");
export const PiDevicesFill: Icon = weighted(Devices, "fill", "PiDevicesFill");
export const PiDotsSixVerticalFill: Icon = weighted(DotsSixVertical, "fill", "PiDotsSixVerticalFill");
export const PiDotsThreeBold: Icon = weighted(DotsThree, "bold", "PiDotsThreeBold");
export const PiDotsThreeCircleFill: Icon = weighted(DotsThreeCircle, "fill", "PiDotsThreeCircleFill");
export const PiDotsThreeVerticalBold: Icon = weighted(DotsThreeVertical, "bold", "PiDotsThreeVerticalBold");
export const PiDownloadSimpleFill: Icon = weighted(DownloadSimple, "fill", "PiDownloadSimpleFill");
export const PiEnvelopeFill: Icon = weighted(Envelope, "fill", "PiEnvelopeFill");
export const PiEyeFill: Icon = weighted(Eye, "fill", "PiEyeFill");
export const PiEyeSlashFill: Icon = weighted(EyeSlash, "fill", "PiEyeSlashFill");
export const PiFadersHorizontalFill: Icon = weighted(FadersHorizontal, "fill", "PiFadersHorizontalFill");
export const PiFileAudioFill: Icon = weighted(FileAudio, "fill", "PiFileAudioFill");
export const PiFileFill: Icon = weighted(File, "fill", "PiFileFill");
export const PiFileTextFill: Icon = weighted(FileText, "fill", "PiFileTextFill");
export const PiFileVideoFill: Icon = weighted(FileVideo, "fill", "PiFileVideoFill");
export const PiFileZipFill: Icon = weighted(FileZip, "fill", "PiFileZipFill");
export const PiFlagFill: Icon = weighted(Flag, "fill", "PiFlagFill");
export const PiFlaskFill: Icon = weighted(Flask, "fill", "PiFlaskFill");
export const PiFolderFill: Icon = weighted(Folder, "fill", "PiFolderFill");
export const PiGameControllerFill: Icon = weighted(GameController, "fill", "PiGameControllerFill");
export const PiGaugeFill: Icon = weighted(Gauge, "fill", "PiGaugeFill");
export const PiGearFill: Icon = weighted(Gear, "fill", "PiGearFill");
export const PiGearSixFill: Icon = weighted(GearSix, "fill", "PiGearSixFill");
export const PiGlobeSimpleFill: Icon = weighted(GlobeSimple, "fill", "PiGlobeSimpleFill");
export const PiHandWavingFill: Icon = weighted(HandWaving, "fill", "PiHandWavingFill");
export const PiHardDrivesFill: Icon = weighted(HardDrives, "fill", "PiHardDrivesFill");
export const PiHouseFill: Icon = weighted(House, "fill", "PiHouseFill");
export const PiImageFill: Icon = weighted(Image, "fill", "PiImageFill");
export const PiInfoBold: Icon = weighted(Info, "bold", "PiInfoBold");
export const PiInfoFill: Icon = weighted(Info, "fill", "PiInfoFill");
export const PiKey: Icon = Key;
export const PiKeyboardFill: Icon = weighted(Keyboard, "fill", "PiKeyboardFill");
export const PiLinkFill: Icon = weighted(Link, "fill", "PiLinkFill");
export const PiLinkSimpleBold: Icon = weighted(LinkSimple, "bold", "PiLinkSimpleBold");
export const PiList: Icon = List;
export const PiListChecksFill: Icon = weighted(ListChecks, "fill", "PiListChecksFill");
export const PiLockOpen: Icon = LockOpen;
export const PiLockSimpleFill: Icon = weighted(LockSimple, "fill", "PiLockSimpleFill");
export const PiMagnifyingGlassBold: Icon = weighted(MagnifyingGlass, "bold", "PiMagnifyingGlassBold");
export const PiMagnifyingGlassMinusBold: Icon = weighted(MagnifyingGlassMinus, "bold", "PiMagnifyingGlassMinusBold");
export const PiMagnifyingGlassPlusBold: Icon = weighted(MagnifyingGlassPlus, "bold", "PiMagnifyingGlassPlusBold");
export const PiMagnifyingGlassFill: Icon = weighted(MagnifyingGlass, "fill", "PiMagnifyingGlassFill");
export const PiMicrophoneFill: Icon = weighted(Microphone, "fill", "PiMicrophoneFill");
export const PiMicrophoneSlashFill: Icon = weighted(MicrophoneSlash, "fill", "PiMicrophoneSlashFill");
export const PiMinusBold: Icon = weighted(Minus, "bold", "PiMinusBold");
export const PiMinusCircleFill: Icon = weighted(MinusCircle, "fill", "PiMinusCircleFill");
export const PiMonitorArrowUpFill: Icon = weighted(MonitorArrowUp, "fill", "PiMonitorArrowUpFill");
export const PiMonitorFill: Icon = weighted(Monitor, "fill", "PiMonitorFill");
export const PiPaletteFill: Icon = weighted(Palette, "fill", "PiPaletteFill");
export const PiPencilSimpleBold: Icon = weighted(PencilSimple, "bold", "PiPencilSimpleBold");
export const PiPencilSimpleFill: Icon = weighted(PencilSimple, "fill", "PiPencilSimpleFill");
export const PiPhoneCallFill: Icon = weighted(PhoneCall, "fill", "PiPhoneCallFill");
export const PiPhoneDisconnectFill: Icon = weighted(PhoneDisconnect, "fill", "PiPhoneDisconnectFill");
export const PiPhoneFill: Icon = weighted(Phone, "fill", "PiPhoneFill");
export const PiPhoneXFill: Icon = weighted(PhoneX, "fill", "PiPhoneXFill");
export const PiPlayFill: Icon = weighted(Play, "fill", "PiPlayFill");
export const PiPlus: Icon = Plus;
export const PiPlusBold: Icon = weighted(Plus, "bold", "PiPlusBold");
export const PiProhibitBold: Icon = weighted(Prohibit, "bold", "PiProhibitBold");
export const PiProhibitFill: Icon = weighted(Prohibit, "fill", "PiProhibitFill");
export const PiPushPinFill: Icon = weighted(PushPin, "fill", "PiPushPinFill");
export const PiPushPinSlashFill: Icon = weighted(PushPinSlash, "fill", "PiPushPinSlashFill");
export const PiPuzzlePieceFill: Icon = weighted(PuzzlePiece, "fill", "PiPuzzlePieceFill");
export const PiRobotFill: Icon = weighted(Robot, "fill", "PiRobotFill");
export const PiScanSmileyFill: Icon = weighted(ScanSmiley, "fill", "PiScanSmileyFill");
export const PiScreencastFill: Icon = weighted(Screencast, "fill", "PiScreencastFill");
export const PiShieldCheckFill: Icon = weighted(ShieldCheck, "fill", "PiShieldCheckFill");
export const PiShieldWarningFill: Icon = weighted(ShieldWarning, "fill", "PiShieldWarningFill");
export const PiSignInBold: Icon = weighted(SignIn, "bold", "PiSignInBold");
export const PiSignInFill: Icon = weighted(SignIn, "fill", "PiSignInFill");
export const PiSignOutFill: Icon = weighted(SignOut, "fill", "PiSignOutFill");
export const PiSignpost: Icon = Signpost;
export const PiSlidersHorizontalFill: Icon = weighted(SlidersHorizontal, "fill", "PiSlidersHorizontalFill");
export const PiSpeakerHighFill: Icon = weighted(SpeakerHigh, "fill", "PiSpeakerHighFill");
export const PiSpeakerSimpleHighFill: Icon = weighted(SpeakerSimpleHigh, "fill", "PiSpeakerSimpleHighFill");
export const PiSpeakerSimpleSlashFill: Icon = weighted(SpeakerSimpleSlash, "fill", "PiSpeakerSimpleSlashFill");
export const PiSpeakerSlashFill: Icon = weighted(SpeakerSlash, "fill", "PiSpeakerSlashFill");
export const PiSquaresFourFill: Icon = weighted(SquaresFour, "fill", "PiSquaresFourFill");
export const PiStopFill: Icon = weighted(Stop, "fill", "PiStopFill");
export const PiUploadSimple: Icon = UploadSimple;
export const PiUploadSimpleFill: Icon = weighted(UploadSimple, "fill", "PiUploadSimpleFill");
export const PiUserFill: Icon = weighted(User, "fill", "PiUserFill");
export const PiUserPlusFill: Icon = weighted(UserPlus, "fill", "PiUserPlusFill");
export const PiUsersThreeFill: Icon = weighted(UsersThree, "fill", "PiUsersThreeFill");
export const PiWarningCircle: Icon = WarningCircle;
export const PiWarningCircleFill: Icon = weighted(WarningCircle, "fill", "PiWarningCircleFill");
export const PiWarningFill: Icon = weighted(Warning, "fill", "PiWarningFill");
export const PiWebhooksLogoFill: Icon = weighted(WebhooksLogo, "fill", "PiWebhooksLogoFill");
export const PiWifiSlashFill: Icon = weighted(WifiSlash, "fill", "PiWifiSlashFill");
export const PiX: Icon = X;
export const PiXBold: Icon = weighted(X, "bold", "PiXBold");
export const PiXCircleFill: Icon = weighted(XCircle, "fill", "PiXCircleFill");
export const PiSidebarSimpleFill: Icon = weighted(SidebarSimple, "fill", "PiSidebarSimpleFill");
export const PiPlugsFill: Icon = weighted(Plugs, "fill", "PiPlugsFill");
export const PiPulseBold: Icon = weighted(Pulse, "bold", "PiPulseBold");

/** A teardrop message with a pin cut into its corner, for the pinned messages list (GRYT-1783).
    Masked rather than outlined in the background colour, so it holds on any surface. */
export const PiPinnedMessages = (({ size = "1em", color = "currentColor", ...rest }: IconProps) => {
  const mask = `pin-${useId().replace(/:/g, "")}`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 256 256" fill={color} {...rest}>
      <mask id={mask}>
        <rect width="256" height="256" fill="white" />
        <circle cx="200" cy="58" r="80" fill="black" />
      </mask>
      <g mask={`url(#${mask})`}>
        <ChatTeardropText size={256} />
      </g>
      <PushPin weight="fill" size={120} x={140} y={-2} />
    </svg>
  );
}) as Icon;

export const PiArrowCircleUpFill: Icon = weighted(ArrowCircleUp, "fill", "PiArrowCircleUpFill");
export const PiBellSimpleFill: Icon = weighted(BellSimple, "fill", "PiBellSimpleFill");
export const PiCameraSlashFill: Icon = weighted(CameraSlash, "fill", "PiCameraSlashFill");
export const PiDoorOpenBold: Icon = weighted(DoorOpen, "bold", "PiDoorOpenBold");
export const PiFilePlusFill: Icon = weighted(FilePlus, "fill", "PiFilePlusFill");
export const PiFingerprintFill: Icon = weighted(Fingerprint, "fill", "PiFingerprintFill");
export const PiGiftFill: Icon = weighted(Gift, "fill", "PiGiftFill");
export const PiHouseLineFill: Icon = weighted(HouseLine, "fill", "PiHouseLineFill");
export const PiShieldSlashFill: Icon = weighted(ShieldSlash, "fill", "PiShieldSlashFill");
export const PiSmileyWinkBold: Icon = weighted(SmileyWink, "bold", "PiSmileyWinkBold");
export const PiSmileyWinkFill: Icon = weighted(SmileyWink, "fill", "PiSmileyWinkFill");
export const PiTrashSimpleBold: Icon = weighted(TrashSimple, "bold", "PiTrashSimpleBold");
export const PiTrashSimpleFill: Icon = weighted(TrashSimple, "fill", "PiTrashSimpleFill");
